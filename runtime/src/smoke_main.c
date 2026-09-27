/*
 * runtime-smoke — a standalone `main` that exercises `mn_alloc` directly.
 *
 * This is not a Menard program: it stands in for the code the compiler will
 * eventually emit, so the allocator and panic path can be checked before
 * the emitter exists. See `runtime/README.md`.
 */
#include "menard.h"

#include <unistd.h>

static MnShape smoke_shape = {.tag = 0, .nbytes = 24, .layout = MN_LAYOUT_ORDINARY};

int main(void) {
  /* size includes the 8-byte shape header + payload slots. */
  MnWord *a = (MnWord *)mn_alloc(16, &smoke_shape); /* header + 1 slot */
  MnWord *b = (MnWord *)mn_alloc(24, &smoke_shape); /* header + 2 slots */

  if (a == NULL || b == NULL) {
    mn_panic("smoke: mn_alloc returned NULL");
  }

  if (mn_obj_shape(a) != &smoke_shape || mn_obj_shape(b) != &smoke_shape) {
    mn_panic("smoke: mn_alloc did not store the shape header");
  }

  /* Payload slots after the header start zeroed (empty word). */
  if (a[1] != MN_EMPTY || b[1] != MN_EMPTY || b[2] != MN_EMPTY) {
    mn_panic("smoke: mn_alloc did not zero its payload");
  }

  a[1] = mn_int_to_word(41);
  b[1] = mn_int_to_word(1);
  b[2] = a[1];

  if (mn_word_to_int(a[1]) != 41 || mn_word_to_int(b[2]) != 41) {
    mn_panic("smoke: allocated memory did not round-trip a tagged Int");
  }

  if (MN_FALSE != mn_int_to_word(0) || MN_TRUE != mn_int_to_word(1) ||
      MN_UNIT != MN_FALSE) {
    mn_panic("smoke: Bool/Unit immediates drifted from Int tagging");
  }

  write(1, "ok\n", 3);
  return 0;
}
