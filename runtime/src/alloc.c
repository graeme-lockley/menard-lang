/*
 * Bump nursery + mark-sweep old space (spec §4.2, §4.3).
 *
 * Every heap object is an 8-byte size prefix followed by the user
 * pointer `mn_alloc` returns. The prefix is not part of the Menard
 * object. Static objects have no prefix and are never allocated here.
 *
 * Minor collection copies nursery survivors into old space. Major
 * collection mark-sweeps old space only, and only after it grows past
 * a threshold. `mn_alloc` is the only mutator entry that collects.
 */
#include "gc_internal.h"

#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>

typedef struct OldChunk {
  struct OldChunk *next;
  uint8_t *base;
  size_t cap;
  size_t used;
} OldChunk;

static uint8_t *nursery = NULL;
static size_t nursery_cap = MN_NURSERY_BYTES;
static size_t nursery_used = 0;

static OldChunk *old_chunks = NULL;
static OldChunk *old_cur = NULL;
static size_t old_used_total = 0;

/* Exact-size free lists. A minor collection promotes by taking one of
   these (or bumping), never by walking every free block — that walk
   made the pause grow with old space. Sizes above half the nursery are
   rare and stay on one list. */
#define MN_FREE_MAX (MN_NURSERY_BYTES / 2)
#define MN_FREE_CLASSES ((MN_FREE_MAX / 8) + 1)
static void *free_cls[MN_FREE_CLASSES];
static void *free_large = NULL;

static int heap_ready = 0;

static void *map_bytes(size_t n) {
  void *mem = mmap(NULL, n, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
  if (mem == MAP_FAILED) {
    mn_panic("mn_alloc: mmap failed");
  }
  return mem;
}

void mn_heap_init(void) {
  if (heap_ready) {
    return;
  }
  nursery = (uint8_t *)map_bytes(nursery_cap);
  nursery_used = 0;
  heap_ready = 1;
  mn_gc_note_exit();
}

int mn_ptr_in_nursery(const void *p) {
  if (nursery == NULL || p == NULL) {
    return 0;
  }
  const uint8_t *u = (const uint8_t *)p;
  return u >= nursery && u < nursery + nursery_cap;
}

static int ptr_in_chunk(const OldChunk *c, const uint8_t *u) {
  return c != NULL && u >= c->base && u < c->base + c->cap;
}

int mn_ptr_in_old(const void *p) {
  const uint8_t *u = (const uint8_t *)p;
  for (OldChunk *c = old_chunks; c != NULL; c = c->next) {
    if (ptr_in_chunk(c, u)) {
      return 1;
    }
  }
  return 0;
}

size_t mn_nursery_cap(void) { return nursery_cap; }
size_t mn_nursery_used(void) { return nursery_used; }
size_t mn_old_used(void) { return old_used_total; }

int mn_nursery_fits(size_t user_size) {
  return nursery != NULL && nursery_used + 8 + user_size <= nursery_cap;
}

static void *bump_into(uint8_t *base, size_t cap, size_t *used, size_t user_size) {
  if (*used + 8 + user_size > cap) {
    return NULL;
  }
  uint8_t *raw = base + *used;
  *used += 8 + user_size;
  uintptr_t *pref = (uintptr_t *)raw;
  *pref = (uintptr_t)user_size;
  void *obj = raw + 8;
  memset(obj, 0, user_size);
  return obj;
}

void *mn_nursery_bump(size_t user_size) {
  mn_heap_init();
  return bump_into(nursery, nursery_cap, &nursery_used, user_size);
}

void mn_nursery_reset(void) { nursery_used = 0; }

static OldChunk *new_chunk(size_t cap) {
  OldChunk *c = (OldChunk *)calloc(1, sizeof(OldChunk));
  if (c == NULL) {
    mn_panic("mn_alloc: old chunk oom");
  }
  c->base = (uint8_t *)map_bytes(cap);
  c->cap = cap;
  c->used = 0;
  c->next = old_chunks;
  old_chunks = c;
  old_cur = c;
  return c;
}

static void freelist_push(void *obj) {
  size_t sz = mn_prefix_size(obj);
  *mn_prefix(obj) = sz | MN_PREF_FREE;
  if (sz <= MN_FREE_MAX && (sz % 8) == 0) {
    size_t i = sz / 8;
    *(void **)obj = free_cls[i];
    free_cls[i] = obj;
    return;
  }
  *(void **)obj = free_large;
  free_large = obj;
}

static void *freelist_take(size_t user_size) {
  void *obj = NULL;
  if (user_size <= MN_FREE_MAX && (user_size % 8) == 0) {
    size_t i = user_size / 8;
    obj = free_cls[i];
    if (obj == NULL) {
      return NULL;
    }
    free_cls[i] = *(void **)obj;
  } else {
    void **prev = &free_large;
    obj = free_large;
    while (obj != NULL) {
      size_t have = mn_prefix_size(obj);
      void *next = *(void **)obj;
      if (have == user_size) {
        *prev = next;
        break;
      }
      prev = (void **)obj;
      obj = next;
    }
    if (obj == NULL) {
      return NULL;
    }
  }
  *mn_prefix(obj) = (uintptr_t)user_size;
  memset(obj, 0, user_size);
  return obj;
}

static void freelist_reset(void) {
  memset(free_cls, 0, sizeof(free_cls));
  free_large = NULL;
}

void *mn_old_alloc(size_t user_size) {
  mn_heap_init();
  void *obj = freelist_take(user_size);
  if (obj != NULL) {
    return obj;
  }
  if (old_cur == NULL) {
    new_chunk(user_size + 8 > MN_OLD_CHUNK_BYTES ? user_size + 8 : MN_OLD_CHUNK_BYTES);
  }
  obj = bump_into(old_cur->base, old_cur->cap, &old_cur->used, user_size);
  if (obj == NULL) {
    size_t cap = old_cur->cap * 2;
    if (cap < user_size + 8) {
      cap = user_size + 8;
    }
    new_chunk(cap);
    obj = bump_into(old_cur->base, old_cur->cap, &old_cur->used, user_size);
  }
  if (obj == NULL) {
    mn_panic("mn_alloc: old space exhausted");
  }
  old_used_total += 8 + user_size;
  return obj;
}

/* Walk every old object, free or live. `fn` returns 0 to stop. */
typedef int (*old_walk_fn)(void *obj, size_t user_size, void *ctx);

static void old_walk(old_walk_fn fn, void *ctx) {
  for (OldChunk *c = old_chunks; c != NULL; c = c->next) {
    size_t off = 0;
    while (off + 8 <= c->used) {
      void *obj = c->base + off + 8;
      size_t sz = mn_prefix_size(obj);
      if (sz < 8 || off + 8 + sz > c->used) {
        mn_panic("mn_gc: old space walk hit a broken prefix");
      }
      if (!fn(obj, sz, ctx)) {
        return;
      }
      off += 8 + sz;
    }
  }
}

void *mn_alloc(int64_t size, void *shape) {
  if (size < (int64_t)sizeof(void *)) {
    mn_panic("mn_alloc: size must include at least the header word");
  }
  mn_heap_init();
  size_t aligned = ((size_t)size + 7u) & ~(size_t)7u;
  mn_gc_before_alloc(aligned);

  void *obj;
  if (aligned > nursery_cap / 2) {
    obj = mn_old_alloc(aligned);
  } else {
    obj = mn_nursery_bump(aligned);
    if (obj == NULL) {
      /* A collection should have made room. Spill this one to old. */
      obj = mn_old_alloc(aligned);
    }
  }
  /* Recycled nursery bytes are not zero. A rooted object whose slots
   * are still being filled must not expose leftover pointers. */
  memset(obj, 0, aligned);
  *(void **)obj = shape;
  return obj;
}

void *mn_realloc(void *old_payload, int64_t size) {
  if (size < 0) {
    mn_panic("mn_realloc: negative size");
  }
  size_t aligned = ((size_t)size + 7u) & ~(size_t)7u;
  if (aligned < 8) {
    aligned = 8;
  }
  void *fresh = mn_alloc((int64_t)aligned, old_payload == NULL ? NULL : *(void **)old_payload);
  if (old_payload != NULL) {
    size_t old_n = mn_prefix_size(old_payload);
    size_t n = old_n < aligned ? old_n : aligned;
    memcpy(fresh, old_payload, n);
    *(void **)fresh = *(void **)old_payload;
  }
  return fresh;
}

/* --- major sweep uses these; defined here so the walk stays local. --- */

static int clear_mark(void *obj, size_t user_size, void *ctx) {
  (void)user_size;
  (void)ctx;
  *mn_prefix(obj) = mn_prefix_size(obj) | (*mn_prefix(obj) & MN_PREF_FREE);
  return 1;
}

static int sweep_one(void *obj, size_t user_size, void *ctx) {
  (void)ctx;
  (void)user_size;
  uintptr_t pref = *mn_prefix(obj);
  if (pref & MN_PREF_MARK) {
    *mn_prefix(obj) = mn_prefix_size(obj); /* clear mark, keep live */
    return 1;
  }
  /* Unmarked, including blocks already free: rebuild the freelist. */
  size_t sz = mn_prefix_size(obj);
  memset(obj, 0, sz);
  freelist_push(obj);
  return 1;
}

void mn_old_clear_marks(void) { old_walk(clear_mark, NULL); }

void mn_old_sweep(void) {
  freelist_reset();
  old_walk(sweep_one, NULL);
}

void mn_old_mark(void *obj) {
  if (!mn_ptr_in_old(obj)) {
    return;
  }
  *mn_prefix(obj) = mn_prefix_size(obj) | MN_PREF_MARK;
}

int mn_old_is_marked(void *obj) {
  return mn_ptr_in_old(obj) && ((*mn_prefix(obj) & MN_PREF_MARK) != 0);
}

int mn_old_is_free(void *obj) {
  return mn_ptr_in_old(obj) && ((*mn_prefix(obj) & MN_PREF_FREE) != 0);
}
