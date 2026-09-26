/*
 * mn_write_stdout / mn_print_i64 — the runtime's fd-1 output path.
 *
 * `write`, not stdio: no buffering to (mis)flush around a `panic` (spec
 * §2.16: pending output must be flushed before a panic — no buffer means
 * nothing to lose), and it matches `runtime/src/panic.c`'s existing style
 * of writing raw bytes with `write(2, ...)` for fd 2. This module is the
 * fd-1 counterpart: `mn_write_stdout` never writes to fd 2, and
 * `mn_panic` never writes to fd 1 — the two output paths stay disjoint.
 *
 * Slice 2C adds this ahead of the lowerer that will call it (see
 * `menard.h`'s declarations): `src/emit/lower.mnd` only lowers `Int`
 * today (real instructions, not a folded constant — see that module's
 * header comment) and never emits a call to either function here.
 * Declaring — and linking — unused runtime symbols is fine; nothing
 * requires every runtime function to be reachable from every program.
 */
#include "menard.h"

#include <unistd.h>

/*
 * `write` may return having written fewer than `n` bytes (a short write),
 * so this loops until every byte is out — the same "own the whole
 * transfer" discipline `mn_panic` gets from writing a single short
 * message in one call, made explicit here because `n` may be large.
 */
void mn_write_stdout(const uint8_t *p, size_t n) {
  size_t off = 0;
  while (off < n) {
    ssize_t w = write(1, p + off, n - off);
    if (w < 0) {
      mn_panic("mn_write_stdout: write failed");
    }
    off += (size_t)w;
  }
}

/*
 * Decimal digits of `v`, most-significant first, no trailing newline —
 * callers that want one (as `println` does) append it themselves, the
 * same division of labour the interpreter's `println` builtin uses
 * (host/src/interp/eval.ts: the value's digits, then one `0x0a` byte).
 *
 * `v` is a plain (untagged) `int64_t`, not a tagged `MnWord`; Menard's
 * `Int` is 63-bit (spec §2.2), so negating it can never overflow an
 * `int64_t`, unlike a full 64-bit two's-complement value.
 */
void mn_print_i64(int64_t v) {
  char buf[32];
  size_t i = sizeof(buf);
  int neg = v < 0;
  uint64_t mag = neg ? (uint64_t)(-v) : (uint64_t)v;

  if (mag == 0) {
    buf[--i] = '0';
  } else {
    while (mag > 0) {
      buf[--i] = (char)('0' + (mag % 10));
      mag /= 10;
    }
  }
  if (neg) {
    buf[--i] = '-';
  }

  mn_write_stdout((const uint8_t *)&buf[i], sizeof(buf) - i);
}
