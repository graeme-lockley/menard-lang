/*
 * mn_shadow_push / mn_shadow_pop — no-op stubs for the shadow-stack
 * rooting ABI (spec §4.4's `mn_root_push`/`mn_root_pop`), reserved for
 * slice 2E's real collector.
 *
 * Phase 2's allocator (`runtime/src/alloc.c`) is a leaking bump
 * allocator: it never collects, so nothing is ever traced and nothing
 * needs to be rooted. These stubs exist purely so the emitter — once a
 * later slice starts lowering allocation sites with push/pop pairs
 * around them, per the rooting rules of spec §4.4 — has something valid
 * to call from day one, exactly as `runtime/src/smoke_main.c` let
 * `mn_alloc` be checked before the emitter existed at all. When slice 2E
 * lands, these two functions grow real bodies; nothing about their
 * signature is expected to change.
 */
#include "menard.h"

void mn_shadow_push(void *slot) {
  (void)slot; /* no roots are tracked yet — see header comment */
}

void mn_shadow_pop(void) {
  /* nothing to pop yet — see header comment */
}
