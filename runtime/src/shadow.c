/*
 * Shadow stack (spec §4.4) — per-task GC roots.
 *
 * Each task owns a RootEnt stack. The mutator pushes/pops on the active
 * task's stack. The collector visits every live task's roots (plus
 * module slots). Cell freelists are process-global.
 */
#include "gc_internal.h"

#include <stdlib.h>
#include <string.h>

typedef struct RootEnt {
  MnWord *ptr;
  int owned;
} RootEnt;

typedef struct CellChunk {
  struct CellChunk *next;
  MnWord cells[1024];
} CellChunk;

struct MnShadow {
  RootEnt *stack;
  int depth;
  int cap;
};

static MnShadow bootstrap;
static MnShadow *active = &bootstrap;

static CellChunk *chunks = NULL;
static int chunk_used = 1024; /* force the first fresh_cell to allocate */
static MnWord **freelist = NULL;
static int free_n = 0;
static int free_cap = 0;

/* All shadows the collector must visit (registered by task.c). */
static MnShadow **all_shadows = NULL;
static int all_shadow_n = 0;
static int all_shadow_cap = 0;

MnShadow *mn_shadow_active(void) { return active; }

void mn_shadow_set_active(MnShadow *s) {
  if (s == NULL) {
    mn_panic("mn_shadow_set_active: null");
  }
  active = s;
}

MnShadow *mn_shadow_new(void) {
  MnShadow *s = (MnShadow *)calloc(1, sizeof(MnShadow));
  if (s == NULL) {
    mn_panic("mn_shadow_new: oom");
  }
  return s;
}

void mn_shadow_free(MnShadow *s) {
  if (s == NULL || s == &bootstrap) {
    return;
  }
  /* Drop owned cells back to the freelist. */
  while (s->depth > 0) {
    s->depth--;
    if (s->stack[s->depth].owned) {
      if (free_n == free_cap) {
        int ncap = free_cap == 0 ? 256 : free_cap * 2;
        MnWord **n = (MnWord **)realloc(freelist, (size_t)ncap * sizeof(MnWord *));
        if (n == NULL) {
          mn_panic("mn_shadow_free: freelist oom");
        }
        freelist = n;
        free_cap = ncap;
      }
      freelist[free_n++] = s->stack[s->depth].ptr;
    }
  }
  free(s->stack);
  free(s);
}

void mn_shadow_register(MnShadow *s) {
  if (s == NULL) {
    return;
  }
  for (int i = 0; i < all_shadow_n; i++) {
    if (all_shadows[i] == s) {
      return;
    }
  }
  if (all_shadow_n == all_shadow_cap) {
    int ncap = all_shadow_cap == 0 ? 8 : all_shadow_cap * 2;
    MnShadow **n = (MnShadow **)realloc(all_shadows, (size_t)ncap * sizeof(MnShadow *));
    if (n == NULL) {
      mn_panic("mn_shadow_register: oom");
    }
    all_shadows = n;
    all_shadow_cap = ncap;
  }
  all_shadows[all_shadow_n++] = s;
}

void mn_shadow_unregister(MnShadow *s) {
  if (s == NULL) {
    return;
  }
  for (int i = 0; i < all_shadow_n; i++) {
    if (all_shadows[i] == s) {
      all_shadows[i] = all_shadows[all_shadow_n - 1];
      all_shadow_n--;
      return;
    }
  }
}

static void grow_stack(MnShadow *sh) {
  int ncap = sh->cap == 0 ? 4096 : sh->cap * 2;
  RootEnt *n = (RootEnt *)realloc(sh->stack, (size_t)ncap * sizeof(RootEnt));
  if (n == NULL) {
    mn_panic("mn_root_push: shadow stack oom");
  }
  sh->stack = n;
  sh->cap = ncap;
}

static MnWord *fresh_cell(void) {
  if (free_n > 0) {
    return freelist[--free_n];
  }
  if (chunk_used >= 1024) {
    CellChunk *c = (CellChunk *)calloc(1, sizeof(CellChunk));
    if (c == NULL) {
      mn_panic("mn_root_keep: cell oom");
    }
    c->next = chunks;
    chunks = c;
    chunk_used = 0;
  }
  return &chunks->cells[chunk_used++];
}

static void recycle_cell(MnWord *cell) {
  if (free_n == free_cap) {
    int ncap = free_cap == 0 ? 256 : free_cap * 2;
    MnWord **n = (MnWord **)realloc(freelist, (size_t)ncap * sizeof(MnWord *));
    if (n == NULL) {
      mn_panic("mn_root_pop: freelist oom");
    }
    freelist = n;
    free_cap = ncap;
  }
  freelist[free_n++] = cell;
}

void mn_root_push(void *slot) {
  if (slot == NULL) {
    mn_panic("mn_root_push: null slot");
  }
  MnShadow *sh = active;
  if (sh->depth == sh->cap) {
    grow_stack(sh);
  }
  *(MnWord *)slot = MN_EMPTY;
  sh->stack[sh->depth].ptr = (MnWord *)slot;
  sh->stack[sh->depth].owned = 0;
  sh->depth++;
}

void mn_root_pop(void) {
  MnShadow *sh = active;
  if (sh->depth <= 0) {
    mn_panic("mn_root_pop: shadow stack underflow");
  }
  sh->depth--;
  if (sh->stack[sh->depth].owned) {
    recycle_cell(sh->stack[sh->depth].ptr);
  }
}

MnWord mn_root_push_word(MnWord slot_bits) {
  mn_root_push((void *)(uintptr_t)slot_bits);
  return MN_UNIT;
}

MnWord mn_root_keep(MnWord value) {
  MnShadow *sh = active;
  MnWord *cell = fresh_cell();
  mn_root_push(cell);
  sh->stack[sh->depth - 1].owned = 1;
  *cell = value;
  return mn_int_to_word((int64_t)(sh->depth - 1));
}

MnWord mn_root_get(MnWord index_tagged) {
  MnShadow *sh = active;
  int64_t i = mn_word_to_int(index_tagged);
  if (i < 0 || i >= (int64_t)sh->depth) {
    mn_panic("mn_root_get: index out of range");
  }
  return *sh->stack[i].ptr;
}

MnWord mn_root_save(void) { return mn_int_to_word((int64_t)active->depth); }

static void restore_to(int d) {
  MnShadow *sh = active;
  if (d < 0 || d > sh->depth) {
    mn_panic("mn_root_restore: bad depth");
  }
  while (sh->depth > d) {
    mn_root_pop();
  }
}

MnWord mn_root_restore(MnWord depth_tagged) {
  restore_to((int)mn_word_to_int(depth_tagged));
  return MN_UNIT;
}

void mn_shadow_push(void *slot) { mn_root_push(slot); }

void mn_shadow_pop(void) { mn_root_pop(); }

static void visit_one(MnShadow *sh, mn_root_visit_fn fn, void *ctx) {
  if (sh == NULL) {
    return;
  }
  for (int i = 0; i < sh->depth; i++) {
    fn(sh->stack[i].ptr, ctx);
  }
}

void mn_shadow_visit(mn_root_visit_fn fn, void *ctx) {
  /* Always visit the active stack (covers bootstrap / main before any
   * task registration) and every registered task shadow. */
  visit_one(active, fn, ctx);
  for (int i = 0; i < all_shadow_n; i++) {
    if (all_shadows[i] != active) {
      visit_one(all_shadows[i], fn, ctx);
    }
  }
}

/*
 * Module-level `let` slots. The key points at an LLVM string global, which
 * never moves. The value is a Menard word and is visited with the shadow
 * stack. `mn_root_push` is the wrong tool here: it clears the word and the
 * init frame pops it.
 */
typedef struct MnSlot {
  const char *key;
  int64_t len;
  MnWord value;
} MnSlot;

static MnSlot *slots = NULL;
static int slot_n = 0;
static int slot_cap = 0;

static int slot_eq(const MnSlot *s, const char *key, int64_t len) {
  return s->len == len && memcmp(s->key, key, (size_t)len) == 0;
}

static MnSlot *slot_find(const char *key, int64_t len) {
  for (int i = 0; i < slot_n; i++) {
    if (slot_eq(&slots[i], key, len)) {
      return &slots[i];
    }
  }
  return NULL;
}

MnWord mn_slot_get(int64_t key_bits, int64_t len) {
  const char *key = (const char *)(uintptr_t)key_bits;
  MnSlot *s = slot_find(key, len);
  if (s == NULL) {
    mn_panic("mn_slot_get: missing slot");
  }
  return s->value;
}

MnWord mn_slot_set(int64_t key_bits, int64_t len, MnWord value) {
  const char *key = (const char *)(uintptr_t)key_bits;
  MnSlot *s = slot_find(key, len);
  if (s != NULL) {
    s->value = value;
    return MN_UNIT;
  }
  if (slot_n == slot_cap) {
    int ncap = slot_cap == 0 ? 8 : slot_cap * 2;
    MnSlot *n = (MnSlot *)realloc(slots, (size_t)ncap * sizeof(MnSlot));
    if (n == NULL) {
      mn_panic("mn_slot_set: oom");
    }
    slots = n;
    slot_cap = ncap;
  }
  slots[slot_n].key = key;
  slots[slot_n].len = len;
  slots[slot_n].value = value;
  slot_n++;
  return MN_UNIT;
}

void mn_slots_visit(mn_root_visit_fn fn, void *ctx) {
  for (int i = 0; i < slot_n; i++) {
    fn(&slots[i].value, ctx);
  }
}
