/*
 * Shared by alloc.c, gc.c, and shadow.c. Not part of the Menard ABI.
 */
#ifndef MENARD_GC_INTERNAL_H
#define MENARD_GC_INTERNAL_H

#include "menard.h"

#include <stddef.h>
#include <stdint.h>

#define MN_NURSERY_BYTES ((size_t)256 * 1024)
#define MN_OLD_CHUNK_BYTES ((size_t)1024 * 1024)

/* Prefix word, immediately before the user object.
   REMEMBERED dedups the minor remembered set so a minor pause scans
   each dirty old object once, not once per store. */
#define MN_PREF_MARK ((uintptr_t)1 << 63)
#define MN_PREF_FREE ((uintptr_t)1 << 62)
#define MN_PREF_REMEMBERED ((uintptr_t)1 << 61)
#define MN_PREF_FLAGS (MN_PREF_MARK | MN_PREF_FREE | MN_PREF_REMEMBERED)

static inline uintptr_t *mn_prefix(void *obj) { return ((uintptr_t *)obj) - 1; }

static inline size_t mn_prefix_size(void *obj) {
  return (size_t)(*mn_prefix(obj) & ~MN_PREF_FLAGS);
}

void mn_heap_init(void);
int mn_ptr_in_nursery(const void *p);
int mn_ptr_in_old(const void *p);
size_t mn_nursery_cap(void);
size_t mn_nursery_used(void);
size_t mn_old_used(void);
int mn_nursery_fits(size_t user_size);
void *mn_nursery_bump(size_t user_size);
void mn_nursery_reset(void);
void *mn_old_alloc(size_t user_size);
void mn_old_clear_marks(void);
void mn_old_sweep(void);
void mn_old_mark(void *obj);
int mn_old_is_marked(void *obj);
int mn_old_is_free(void *obj);

/* Called by mn_alloc before the bump. May collect. */
void mn_gc_before_alloc(size_t user_size);

void mn_gc_minor(void);
void mn_gc_major(void);

/* Relocate one slot. Used by the shadow-stack walk. */
void mn_gc_relocate_slot(MnWord *slot);

typedef void (*mn_root_visit_fn)(MnWord *slot, void *ctx);
void mn_shadow_visit(mn_root_visit_fn fn, void *ctx);
void mn_slots_visit(mn_root_visit_fn fn, void *ctx);

int mn_gc_stress(void);
int mn_gc_verify(void);
void mn_gc_note_exit(void);

#endif
