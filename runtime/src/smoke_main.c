/*
 * runtime-smoke — a standalone `main` that exercises `mn_alloc` directly.
 *
 * This is not a Menard program: it stands in for the code the compiler will
 * eventually emit, so the allocator and panic path can be checked before
 * the emitter exists. See `runtime/README.md`.
 */
#include "menard.h"

#include <unistd.h>

int main(void) {
  MnWord *a = (MnWord *)mn_alloc(8, NULL);
  MnWord *b = (MnWord *)mn_alloc(16, NULL);

  if (a == NULL || b == NULL) {
    mn_panic("smoke: mn_alloc returned NULL");
  }

  /* A freshly allocated body is zeroed — this must read as the empty word. */
  if (a[0] != MN_EMPTY || b[0] != MN_EMPTY || b[1] != MN_EMPTY) {
    mn_panic("smoke: mn_alloc did not zero its body");
  }

  a[0] = mn_int_to_word(41);
  b[0] = mn_int_to_word(1);
  b[1] = a[0];

  if (mn_word_to_int(a[0]) != 41 || mn_word_to_int(b[1]) != 41) {
    mn_panic("smoke: allocated memory did not round-trip a tagged Int");
  }

  write(1, "ok\n", 3);
  return 0;
}
