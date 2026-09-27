/*
 * mn_alloc — phase 2/3's leaking bump allocator.
 *
 * Reserve one large arena with mmap and hand out bytes from the front of it,
 * forever. Nothing is ever freed and nothing ever moves: "get self-hosting
 * with a broken memory model, *then* make it correct" (spec §5).
 *
 * Every object begins with a shape pointer at offset 0 (spec §2.2.1). The
 * `size` argument includes that header word; the returned pointer is the
 * object itself (even, 8-byte aligned).
 */
#include "menard.h"

#include <stdint.h>
#include <string.h>
#include <sys/mman.h>

/*
 * Reserved, not committed: mmap with MAP_ANON hands back address space that
 * the OS backs with physical pages lazily, on first touch. A program that
 * never allocates near the limit never pays for it.
 */
#define MN_ARENA_SIZE ((size_t)1 << 30) /* 1 GiB */

static uint8_t *mn_arena_base = NULL;
static size_t mn_arena_used = 0;

static void mn_arena_init(void) {
  void *mem = mmap(NULL, MN_ARENA_SIZE, PROT_READ | PROT_WRITE,
                    MAP_PRIVATE | MAP_ANON, -1, 0);
  if (mem == MAP_FAILED) {
    mn_panic("mn_alloc: mmap failed to reserve the arena");
  }
  mn_arena_base = (uint8_t *)mem;
  mn_arena_used = 0;
}

void *mn_alloc(int64_t size, void *shape) {
  if (size < (int64_t)sizeof(void *)) {
    mn_panic("mn_alloc: size must include at least the header word");
  }

  if (mn_arena_base == NULL) {
    mn_arena_init();
  }

  /* Every allocation is 8-byte aligned (spec invariant 2). */
  size_t requested = (size_t)size;
  size_t aligned = (requested + 7u) & ~(size_t)7u;

  if (aligned > MN_ARENA_SIZE - mn_arena_used) {
    mn_panic("mn_alloc: arena exhausted");
  }

  void *result = mn_arena_base + mn_arena_used;
  mn_arena_used += aligned;

  /*
   * mn_alloc zeroes the body: this is what makes the empty word (MN_EMPTY)
   * a safe read for every unwritten slot, including — once phase 4 recycles
   * memory — a promoted or reused object (spec §4.2 / decisions.md,
   * "Zeroing is now justified, not asserted").
   */
  memset(result, 0, aligned);

  /* Shape pointer at offset 0 — the object's header (spec §2.2.1). */
  *(void **)result = shape;

  return result;
}
