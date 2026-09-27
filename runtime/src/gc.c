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
 */
#include "gc_internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static int in_gc = 0;
static int flags_read = 0;
static int stress = 0;
static int verify = 0;
static int stats_on = 0;
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

static size_t old_threshold = MN_OLD_CHUNK_BYTES;

static void **remembered = NULL;
static size_t remembered_n = 0;
static size_t remembered_cap = 0;

static void **work = NULL;
static size_t work_n = 0;
static size_t work_cap = 0;

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
    if (((uintptr_t)p & (uintptr_t)7) != 0) {
      mn_panic("mn_gc: static object is not 8-byte aligned");
    }
    return; /* static leaf */
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
  mn_old_clear_marks();
  work_n = 0;
  mn_shadow_visit(verify_root, NULL);
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
  work_n = 0;
  mn_shadow_visit(visit_root, NULL);
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
    minor_collect();
    minor_count++;
  }
  mn_old_clear_marks();
  work_n = 0;
  mn_shadow_visit(major_root, NULL);
  size_t i = 0;
  while (i < work_n) {
    major_scan(work[i]);
    i++;
  }
  work_n = 0;
  mn_old_sweep();
  /* Sweep rewrites prefixes, which drops REMEMBERED. Drop the list too. */
  remembered_n = 0;
  size_t used = mn_old_used();
  size_t next = used * 2;
  if (next < MN_OLD_CHUNK_BYTES) {
    next = MN_OLD_CHUNK_BYTES;
  }
  old_threshold = next;
  verify_heap();
}

void mn_gc_minor(void) {
  if (in_gc) {
    return;
  }
  in_gc = 1;
  uint64_t t0 = now_ns();
  minor_collect();
  uint64_t dt = now_ns() - t0;
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
