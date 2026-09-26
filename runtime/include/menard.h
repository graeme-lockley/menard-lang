/*
 * Menard runtime — C11, phase 2.
 *
 * Every Menard value occupies one 64-bit word (spec §2.2): a tagged
 * immediate (odd) or a pointer to a heap or static object (even, 8-byte
 * aligned). `MnWord` is that word.
 *
 * Phase 2 is a leaking bump allocator — see spec §5 ("Phase 2 deliberately
 * leaks") and `runtime/README.md`. No collector runs yet; `mn_alloc` never
 * frees and never moves anything.
 */
#ifndef MENARD_RUNTIME_H
#define MENARD_RUNTIME_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* One 64-bit machine word: an immediate or a pointer, per spec §2.2. */
typedef uint64_t MnWord;

/*
 * The empty word — 0. Not a reference to anything; the only even word that
 * is not the address of an object or a function (spec §2.2, "the empty
 * word"). `mn_alloc` zeroes every body it hands out, so an unwritten slot
 * always reads as this.
 */
#define MN_EMPTY ((MnWord)0)

/*
 * `Int` is 63-bit signed, tagged in the low bit: t(v) = (v << 1) | 1, held
 * in an `i64` (spec §2.2, "why Int is 63 bits"). `+` and `-` are exact on
 * the tagged form directly; multiply, divide and shift must untag, operate
 * on the native width, and retag — see the spec's arithmetic rules. These
 * two functions are the tag/untag primitives only.
 */
static inline MnWord mn_int_to_word(int64_t v) {
  return (MnWord)(((uint64_t)v << 1) | (uint64_t)1);
}

static inline int64_t mn_word_to_int(MnWord w) {
  /* Arithmetic right shift on the signed reinterpretation sign-extends,
   * recovering the original 63-bit value. */
  return ((int64_t)w) >> 1;
}

/* Odd => immediate (spec invariant 1); even => pointer (invariant 2). */
static inline int mn_is_immediate(MnWord w) {
  return (int)(w & (MnWord)1);
}

/*
 * mn_alloc — allocate `size` bytes, 8-byte aligned, zeroed.
 *
 * Phase 2's implementation (`runtime/src/alloc.c`) bump-allocates from a
 * single reserved arena and never frees. `shape` is accepted for ABI
 * compatibility with the eventual collector (spec §4.4:
 * `mn_alloc(size, shape)`, where `shape` is a pointer to the object's
 * static shape descriptor) but phase 2 does not dereference it.
 *
 * Panics (does not return NULL) if the arena is exhausted or `size` is
 * negative.
 */
void *mn_alloc(int64_t size, void *shape);

/*
 * mn_panic — the runtime's terminal failure path. Writes `message` to fd 2
 * (spec §2.16: flush stderr before panic) and terminates the process.
 * Never returns.
 */
_Noreturn void mn_panic(const char *message);

/*
 * mn_write_stdout — write `n` raw bytes to fd 1 (`runtime/src/print.c`).
 * fd 1 carries only the compiled program's own output (spec §2.16) —
 * never a panic message, which always goes through `mn_panic` to fd 2
 * instead. Not yet called by any emitted code (slice 2C adds the
 * runtime side of `print`/`println` lowering ahead of the lowerer that
 * will call it); declaring it here now is enough for `clang` to link a
 * program against the runtime without a missing-symbol error later.
 */
void mn_write_stdout(const uint8_t *p, size_t n);

/*
 * mn_print_i64 — write `v`'s decimal representation (no trailing
 * newline) to fd 1 via `mn_write_stdout`. A small helper for whatever
 * later slice lowers `show`/`print` on `Int` to a direct runtime call
 * instead of a full `show`-then-`write` sequence; unused for now, same
 * rationale as `mn_write_stdout` above.
 */
void mn_print_i64(int64_t v);

/*
 * mn_shadow_push / mn_shadow_pop — no-op stand-ins for the shadow-stack
 * rooting ABI (spec §4.4's `mn_root_push`/`mn_root_pop`), reserved for
 * slice 2E's collector (`runtime/src/shadow.c`). Phase 2's allocator
 * (`runtime/src/alloc.c`) never collects, so nothing needs rooting yet;
 * these exist only so emitted code can start carrying push/pop pairs
 * around allocation sites before the collector that reads them exists.
 */
void mn_shadow_push(void *slot);
void mn_shadow_pop(void);

#ifdef __cplusplus
}
#endif

#endif /* MENARD_RUNTIME_H */
