/*
 * Copying minor collection and mark-sweep major collection.
 *
 * A minor pause traces the shadow stack and the remembered set, copies
 * nursery survivors into old space, and resets the nursery. It does not
 * walk old space. A major collection runs only after old space crosses a
 * growth threshold; it is the only pause that marks the retained heap.
 *
 * MENARD_GC_STRESS  — minor-collect on every mn_alloc.
 * MENARD_HEAP_VERIFY — check roots and layout after each collection.
 * MENARD_GC_STATS — print mn_gc_stats on the way out.
 * MENARD_GC_TRACE — after each collection, write
 *   `gc minor|major size=<bytes> freed=<bytes> duration_ns=<ns>`.
 *   size is the bytes in use at the start of that collection (nursery
 *   occupancy, or old-space objects that are not already free), including
 *   the 8-byte allocator prefix. freed is the part that was not retained.
 * MENARD_GC_TRACE_OUT — `stdout` when unset, or a file path to truncate
 *   and write. The trace uses write(2), so it is not stuck in a stdio buffer.
 */
#include "gc_internal.h"

#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static int in_gc = 0;
static int flags_read = 0;
static int stress = 0;
static int verify = 0;
static int stats_on = 0;
static int trace_on = 0;
static const char *trace_dest = NULL;
static int trace_fd = -1;
static int trace_ready = 0;
static int exit_hooked = 0;

static uint64_t minor_count = 0;
static uint64_t major_count = 0;
static uint64_t minor_last_ns = 0;
static uint64_t minor_max_ns = 0;
static uint64_t major_last_ns = 0;
static uint64_t major_max_ns = 0;
static uint64_t first_minor_ns = 0;
static size_t first_minor_old = 0;
static size_t first_minor_copied = 0;
static size_t last_minor_old = 0;
static size_t last_minor_copied = 0;
static size_t copied_bytes = 0;
static size_t copied_objs = 0;

static size_t old_threshold = MN_OLD_CHUNK_BYTES;

static void **remembered = NULL;
static size_t remembered_n = 0;
static size_t remembered_cap = 0;

static void **work = NULL;
static size_t work_n = 0;
static size_t work_cap = 0;

static void **statics = NULL;
static size_t static_n = 0;
static size_t static_cap = 0;

static uint64_t now_ns(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}

static void read_flags(void) {
  if (flags_read) {
    return;
  }
  flags_read = 1;
  stress = getenv("MENARD_GC_STRESS") != NULL;
  verify = getenv("MENARD_HEAP_VERIFY") != NULL;
  stats_on = getenv("MENARD_GC_STATS") != NULL;
  trace_on = getenv("MENARD_GC_TRACE") != NULL;
  trace_dest = getenv("MENARD_GC_TRACE_OUT");
}

static void trace_write(const char *p, size_t n) {
  size_t off = 0;
  while (off < n) {
    ssize_t w = write(trace_fd, p + off, n - off);
    if (w < 0) {
      mn_panic("mn_gc: trace write failed");
    }
    off += (size_t)w;
  }
}

static void trace_open(void) {
  if (trace_ready) {
    return;
  }
  trace_ready = 1;
  if (trace_dest == NULL || trace_dest[0] == '\0' || strcmp(trace_dest, "stdout") == 0) {
    trace_fd = 1;
    return;
  }
  trace_fd = open(trace_dest, O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (trace_fd < 0) {
    mn_panic("mn_gc: cannot open MENARD_GC_TRACE_OUT");
  }
}

static void trace_event(const char *kind, size_t size, size_t freed, uint64_t ns) {
  if (!trace_on) {
    return;
  }
  trace_open();
  char buf[160];
  int n = snprintf(buf, sizeof(buf), "gc %s size=%zu freed=%zu duration_ns=%llu\n", kind, size, freed,
                   (unsigned long long)ns);
  if (n < 0 || (size_t)n >= sizeof(buf)) {
    mn_panic("mn_gc: trace line truncated");
  }
  trace_write(buf, (size_t)n);
}

/* Survivors leave the nursery; what stays behind is garbage. */
static void trace_minor_done(size_t before, uint64_t dt) {
  if (!trace_on) {
    return;
  }
  size_t retained = copied_bytes + copied_objs * 8;
  if (retained > before) {
    mn_panic("mn_gc: minor retained more than the nursery held");
  }
  trace_event("minor", before, before - retained, dt);
}

static void stats_hook(void) {
  if (stats_on) {
    mn_gc_stats();
  }
}

void mn_gc_note_exit(void) {
  read_flags();
  if (!exit_hooked) {
    atexit(stats_hook);
    exit_hooked = 1;
  }
}

int mn_gc_stress(void) {
  read_flags();
  return stress;
}

int mn_gc_verify(void) {
  read_flags();
  return verify;
}

static void work_push(void *obj) {
  if (work_n == work_cap) {
    size_t ncap = work_cap == 0 ? 1024 : work_cap * 2;
    void **n = (void **)realloc(work, ncap * sizeof(void *));
    if (n == NULL) {
      mn_panic("mn_gc: worklist oom");
    }
    work = n;
    work_cap = ncap;
  }
  work[work_n++] = obj;
}

void mn_register_static(void *obj) {
  if (obj == NULL) {
    mn_panic("mn_gc: register static received an empty pointer");
  }
  for (size_t i = 0; i < static_n; i++) {
    if (statics[i] == obj) {
      return;
    }
  }
  if (static_n == static_cap) {
    size_t ncap = static_cap == 0 ? 16 : static_cap * 2;
    void **n = (void **)realloc(statics, ncap * sizeof(void *));
    if (n == NULL) {
      mn_panic("mn_gc: static table oom");
    }
    statics = n;
    static_cap = ncap;
  }
  statics[static_n++] = obj;
}

static void remember(void *obj) {
  if (remembered_n == remembered_cap) {
    size_t ncap = remembered_cap == 0 ? 256 : remembered_cap * 2;
    void **n = (void **)realloc(remembered, ncap * sizeof(void *));
    if (n == NULL) {
      mn_panic("mn_gc: remembered set oom");
    }
    remembered = n;
    remembered_cap = ncap;
  }
  remembered[remembered_n++] = obj;
}

void mn_gc_store(void *holder, MnWord *slot, MnWord value) {
  *slot = value;
  if (in_gc || holder == NULL) {
    return;
  }
  if (!mn_ptr_in_old(holder)) {
    return;
  }
  if (mn_is_immediate(value) || value == MN_EMPTY) {
    return;
  }
  if (!mn_ptr_in_nursery((void *)(uintptr_t)value)) {
    return;
  }
  if (mn_old_is_free(holder)) {
    return;
  }
  if ((*mn_prefix(holder) & MN_PREF_REMEMBERED) != 0) {
    return;
  }
  *mn_prefix(holder) |= MN_PREF_REMEMBERED;
  remember(holder);
}

static int is_forward(void *obj) {
  return ((*(uintptr_t *)obj) & (uintptr_t)7) == (uintptr_t)2;
}

static void *forward_target(void *obj) {
  return (void *)((*(uintptr_t *)obj) & ~(uintptr_t)7);
}

static int valid_object(void *p);

static void scan_fields(void *obj);

static MnWord relocate(MnWord w) {
  if (mn_is_immediate(w) || w == MN_EMPTY) {
    return w;
  }
  void *p = (void *)(uintptr_t)w;
  if (((uintptr_t)p & (uintptr_t)7) != 0) {
    mn_panic("mn_gc: misaligned pointer");
  }
  if (!mn_ptr_in_nursery(p)) {
    return w;
  }
  if (is_forward(p)) {
    return (MnWord)(uintptr_t)forward_target(p);
  }
  size_t sz = mn_prefix_size(p);
  void *nobj = mn_old_alloc(sz);
  memcpy(nobj, p, sz);
  *(uintptr_t *)p = ((uintptr_t)nobj) | (uintptr_t)2;
  copied_bytes += sz;
  copied_objs++;
  work_push(nobj);
  return (MnWord)(uintptr_t)nobj;
}

void mn_gc_relocate_slot(MnWord *slot) { *slot = relocate(*slot); }

static void visit_root(MnWord *slot, void *ctx) {
  (void)ctx;
  mn_gc_relocate_slot(slot);
}

static void scan_fields(void *obj) {
  if (is_forward(obj)) {
    return;
  }
  uintptr_t hdr = *(uintptr_t *)obj;
  if (hdr == 0 || (hdr & (uintptr_t)7) != 0) {
    mn_panic("mn_gc: object header is not a shape");
  }
  MnShape *sh = (MnShape *)hdr;
  if (sh->location == MN_LOC_STATIC) {
    return;
  }
  if (sh->layout == MN_LAYOUT_BYTES) {
    return;
  }
  /* Closure slot 0 is the code pointer — not a Menard word. */
  int begin = sh->layout == MN_LAYOUT_CLOSURE ? 2 : 1;
  size_t words = mn_prefix_size(obj) / sizeof(MnWord);
  MnWord *slots = (MnWord *)obj;
  for (size_t i = (size_t)begin; i < words; i++) {
    mn_gc_relocate_slot(&slots[i]);
  }
}

static void drain_work(void) {
  size_t i = 0;
  while (i < work_n) {
    scan_fields(work[i]);
    i++;
  }
  work_n = 0;
}

static int shape_ok(void *p) {
  if (((uintptr_t)p & (uintptr_t)7) != 0) {
    return 0;
  }
  uintptr_t hdr = *(uintptr_t *)p;
  if (hdr == 0 || (hdr & (uintptr_t)7) != 0) {
    return 0;
  }
  return 1;
}

static int valid_object(void *p) {
  if (((uintptr_t)p & (uintptr_t)7) != 0) {
    return 0;
  }
  if (mn_ptr_in_nursery(p) || mn_ptr_in_old(p)) {
    if (mn_ptr_in_old(p) && mn_old_is_free(p)) {
      return 0;
    }
    return shape_ok(p);
  }
  if (!shape_ok(p)) {
    return 0;
  }
  MnShape *sh = *(MnShape **)p;
  return sh->location == MN_LOC_STATIC;
}

/* Static objects are leaves. Ordinary ones are header-only: a word slot
 * would be a second place the collector has to be told what it is looking at. */
static void verify_static(void *obj) {
  if (((uintptr_t)obj & (uintptr_t)7) != 0) {
    mn_panic("mn_gc: static object is not 8-byte aligned");
  }
  if (!shape_ok(obj)) {
    mn_panic("mn_gc: static object has an empty header");
  }
  MnShape *sh = *(MnShape **)obj;
  if (sh->location != MN_LOC_STATIC) {
    mn_panic("mn_gc: registered object is not static");
  }
  if (sh->layout == MN_LAYOUT_BYTES) {
    return;
  }
  if (sh->layout == MN_LAYOUT_ORDINARY && sh->nbytes == (int32_t)sizeof(void *)) {
    return;
  }
  mn_panic("mn_gc: static object holds word slots");
}

static void verify_push(MnWord w) {
  if (mn_is_immediate(w) || w == MN_EMPTY) {
    return;
  }
  void *p = (void *)(uintptr_t)w;
  if (!valid_object(p)) {
    mn_panic("mn_gc: heap-verify found a slot that is not a value");
  }
  if (mn_ptr_in_nursery(p)) {
    mn_panic("mn_gc: heap-verify found a nursery pointer after collection");
  }
  if (!mn_ptr_in_old(p)) {
    verify_static(p);
    return;
  }
  if (mn_old_is_marked(p)) {
    return;
  }
  mn_old_mark(p);
  work_push(p);
}

static void verify_object(void *obj) {
  if (((uintptr_t)obj & (uintptr_t)7) != 0) {
    mn_panic("mn_gc: heap object is not 8-byte aligned");
  }
  if (is_forward(obj)) {
    mn_panic("mn_gc: forwarding pointer escaped the nursery");
  }
  if (!shape_ok(obj)) {
    mn_panic("mn_gc: reachable object has an empty header");
  }
  MnShape *sh = *(MnShape **)obj;
  if (sh->location == MN_LOC_STATIC || sh->layout == MN_LAYOUT_BYTES) {
    return;
  }
  /* Closure: begin at 2 so slot 0 (the code pointer) is not traced. */
  int begin = sh->layout == MN_LAYOUT_CLOSURE ? 2 : 1;
  size_t words = mn_prefix_size(obj) / sizeof(MnWord);
  MnWord *slots = (MnWord *)obj;
  for (size_t i = (size_t)begin; i < words; i++) {
    verify_push(slots[i]);
  }
}

static void verify_root(MnWord *slot, void *ctx) {
  (void)ctx;
  verify_push(*slot);
}

static void verify_heap(void) {
  if (!verify) {
    return;
  }
  if (static_n == 0) {
    mn_panic("mn_gc: heap-verify has no static objects to walk");
  }
  for (size_t s = 0; s < static_n; s++) {
    verify_static(statics[s]);
  }
  mn_old_clear_marks();
  work_n = 0;
  mn_shadow_visit(verify_root, NULL);
  mn_task_visit_roots(verify_root, NULL);
  mn_slots_visit(verify_root, NULL);
  size_t i = 0;
  while (i < work_n) {
    verify_object(work[i]);
    i++;
  }
  work_n = 0;
  mn_old_clear_marks();
}

static void minor_collect(void) {
  copied_bytes = 0;
  copied_objs = 0;
  work_n = 0;
  mn_shadow_visit(visit_root, NULL);
  mn_task_visit_roots(visit_root, NULL);
  mn_slots_visit(visit_root, NULL);
  for (size_t i = 0; i < remembered_n; i++) {
    void *obj = remembered[i];
    if (mn_ptr_in_old(obj) && !mn_old_is_free(obj)) {
      *mn_prefix(obj) &= ~MN_PREF_REMEMBERED;
      scan_fields(obj);
    }
  }
  remembered_n = 0;
  drain_work();
  mn_nursery_reset();
  verify_heap();
}

static void major_push_slot(MnWord w) {
  if (mn_is_immediate(w) || w == MN_EMPTY) {
    return;
  }
  void *p = (void *)(uintptr_t)w;
  if (mn_ptr_in_nursery(p)) {
    mn_panic("mn_gc: major collection saw a nursery pointer");
  }
  if (!mn_ptr_in_old(p)) {
    return; /* static leaf */
  }
  if (mn_old_is_free(p)) {
    mn_panic("mn_gc: major collection traced a free object");
  }
  if (mn_old_is_marked(p)) {
    return;
  }
  mn_old_mark(p);
  work_push(p);
}

static void major_scan(void *obj) {
  if (!shape_ok(obj)) {
    mn_panic("mn_gc: major scan saw a bad header");
  }
  MnShape *sh = *(MnShape **)obj;
  if (sh->location == MN_LOC_STATIC || sh->layout == MN_LAYOUT_BYTES) {
    return;
  }
  int begin = sh->layout == MN_LAYOUT_CLOSURE ? 2 : 1;
  size_t words = mn_prefix_size(obj) / sizeof(MnWord);
  MnWord *slots = (MnWord *)obj;
  for (size_t i = (size_t)begin; i < words; i++) {
    major_push_slot(slots[i]);
  }
}

static void major_root(MnWord *slot, void *ctx) {
  (void)ctx;
  major_push_slot(*slot);
}

static void major_collect(void) {
  if (mn_nursery_used() != 0) {
    size_t before = mn_nursery_used();
    uint64_t t0 = now_ns();
    minor_collect();
    minor_count++;
    trace_minor_done(before, now_ns() - t0);
  }
  uint64_t t0 = now_ns();
  mn_old_clear_marks();
  work_n = 0;
  mn_shadow_visit(major_root, NULL);
  mn_task_visit_roots(major_root, NULL);
  mn_slots_visit(major_root, NULL);
  size_t i = 0;
  while (i < work_n) {
    major_scan(work[i]);
    i++;
  }
  work_n = 0;
  size_t occupied = 0;
  size_t reclaimed = 0;
  mn_old_sweep(&occupied, &reclaimed);
  /* Sweep rewrites prefixes, which drops REMEMBERED. Drop the list too. */
  remembered_n = 0;
  size_t used = mn_old_used();
  size_t next = used * 2;
  if (next < MN_OLD_CHUNK_BYTES) {
    next = MN_OLD_CHUNK_BYTES;
  }
  old_threshold = next;
  verify_heap();
  trace_event("major", occupied, reclaimed, now_ns() - t0);
}

void mn_gc_minor(void) {
  read_flags();
  if (in_gc) {
    return;
  }
  in_gc = 1;
  size_t before = mn_nursery_used();
  uint64_t t0 = now_ns();
  minor_collect();
  uint64_t dt = now_ns() - t0;
  trace_minor_done(before, dt);
  minor_count++;
  minor_last_ns = dt;
  if (dt > minor_max_ns) {
    minor_max_ns = dt;
  }
  if (first_minor_ns == 0) {
    first_minor_ns = dt;
    first_minor_old = mn_old_used();
    first_minor_copied = copied_bytes;
  }
  last_minor_old = mn_old_used();
  last_minor_copied = copied_bytes;
  in_gc = 0;
}

void mn_gc_major(void) {
  read_flags();
  if (in_gc) {
    return;
  }
  in_gc = 1;
  uint64_t t0 = now_ns();
  major_collect();
  uint64_t dt = now_ns() - t0;
  major_count++;
  major_last_ns = dt;
  if (dt > major_max_ns) {
    major_max_ns = dt;
  }
  in_gc = 0;
}

void mn_gc_collect(void) {
  mn_gc_minor();
  mn_gc_major();
}

void mn_gc_before_alloc(size_t user_size) {
  read_flags();
  if (in_gc) {
    return;
  }
  int young = user_size <= mn_nursery_cap() / 2;
  if (stress || (young && !mn_nursery_fits(user_size))) {
    mn_gc_minor();
  }
  if (mn_old_used() > old_threshold) {
    mn_gc_major();
  }
}

void mn_gc_stats(void) {
  fprintf(stderr,
          "mn_gc_stats minor=%llu major=%llu minor_last_ns=%llu minor_max_ns=%llu "
          "major_last_ns=%llu major_max_ns=%llu old_bytes=%zu nursery_bytes=%zu "
          "first_minor_ns=%llu first_minor_old=%zu first_minor_copied=%zu "
          "last_minor_ns=%llu last_minor_old=%zu last_minor_copied=%zu\n",
          (unsigned long long)minor_count, (unsigned long long)major_count,
          (unsigned long long)minor_last_ns, (unsigned long long)minor_max_ns,
          (unsigned long long)major_last_ns, (unsigned long long)major_max_ns,
          mn_old_used(), mn_nursery_cap(), (unsigned long long)first_minor_ns,
          first_minor_old, first_minor_copied, (unsigned long long)minor_last_ns,
          last_minor_old, last_minor_copied);
}
