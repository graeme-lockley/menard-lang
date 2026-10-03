/*
 * Shadow stack (spec §4.4).
 *
 * Each entry is the address of a word the collector updates in place.
 * `mn_root_push` writes the empty word, then records the address.
 * `mn_root_keep` allocates a stable cell, pushes it, and stores the
 * word; the returned tagged index survives later pushes and collections.
 * `mn_root_pop` / `mn_root_restore` drop entries. Cells the stack owns
 * go back to a freelist so a loop does not leak C heap.
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

static RootEnt *stack = NULL;
static int depth = 0;
static int cap = 0;

static CellChunk *chunks = NULL;
static int chunk_used = 1024; /* force the first fresh_cell to allocate */
static MnWord **freelist = NULL;
static int free_n = 0;
static int free_cap = 0;

static void grow_stack(void) {
  int ncap = cap == 0 ? 4096 : cap * 2;
  RootEnt *n = (RootEnt *)realloc(stack, (size_t)ncap * sizeof(RootEnt));
  if (n == NULL) {
    mn_panic("mn_root_push: shadow stack oom");
  }
  stack = n;
  cap = ncap;
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
  if (depth == cap) {
    grow_stack();
  }
  *(MnWord *)slot = MN_EMPTY;
  stack[depth].ptr = (MnWord *)slot;
  stack[depth].owned = 0;
  depth++;
}

void mn_root_pop(void) {
  if (depth <= 0) {
    mn_panic("mn_root_pop: shadow stack underflow");
  }
  depth--;
  if (stack[depth].owned) {
    recycle_cell(stack[depth].ptr);
  }
}

MnWord mn_root_push_word(MnWord slot_bits) {
  mn_root_push((void *)(uintptr_t)slot_bits);
  return MN_UNIT;
}

MnWord mn_root_keep(MnWord value) {
  MnWord *cell = fresh_cell();
  mn_root_push(cell);
  stack[depth - 1].owned = 1;
  *cell = value;
  return mn_int_to_word((int64_t)(depth - 1));
}

MnWord mn_root_get(MnWord index_tagged) {
  int64_t i = mn_word_to_int(index_tagged);
  if (i < 0 || i >= (int64_t)depth) {
    mn_panic("mn_root_get: index out of range");
  }
  return *stack[i].ptr;
}

MnWord mn_root_save(void) { return mn_int_to_word((int64_t)depth); }

static void restore_to(int d) {
  if (d < 0 || d > depth) {
    mn_panic("mn_root_restore: bad depth");
  }
  while (depth > d) {
    mn_root_pop();
  }
}

MnWord mn_root_restore(MnWord depth_tagged) {
  restore_to((int)mn_word_to_int(depth_tagged));
  return MN_UNIT;
}

void mn_shadow_push(void *slot) { mn_root_push(slot); }

void mn_shadow_pop(void) { mn_root_pop(); }

void mn_shadow_visit(mn_root_visit_fn fn, void *ctx) {
  for (int i = 0; i < depth; i++) {
    fn(stack[i].ptr, ctx);
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
