# Menard runtime

The C11 runtime the compiled backend links against. Phase 2 only (spec §5):
a **leaking bump allocator** — no `free`, no collector. "Get self-hosting
with a broken memory model, *then* make it correct."

## Layout

| Path | Role |
| --- | --- |
| `include/menard.h` | `MnWord`, the empty word, `Int` tag/untag, `mn_alloc`, `mn_panic`, `mn_write_stdout`, `mn_print_i64`, `mn_shadow_push`/`mn_shadow_pop` |
| `src/alloc.c` | `mn_alloc` — bump-allocates from one `mmap`-reserved arena; never frees |
| `src/panic.c` | `mn_panic` — writes the message to fd 2, then `_exit(1)`; never returns |
| `src/print.c` | `mn_write_stdout` / `mn_print_i64` — fd-1 output, disjoint from `mn_panic`'s fd 2 |
| `src/io.c` | `mn_write` — completes short writes, retries `EINTR`, and returns `Result Unit IoError`; used by `std/io.write` and `write-line` |
| `src/shadow.c` | `mn_shadow_push` / `mn_shadow_pop` — no-op rooting stubs, reserved for slice 2E's collector |
| `src/smoke_main.c` | A standalone `main` exercising the allocator (no compiled Menard code exists yet) |
| `fixtures/` | A minimal bitcode program, for reference — see below |

Compiled Menard programs provide their own `main` (the emitter's entry
point); `smoke_main.c` exists only so the allocator can be checked before
the emitter does.

`make ret-native` / `make hello-native` link the emitted `.bc` against
`alloc.c` + `panic.c` + `print.c` + `shadow.c` (the Makefile's
`RUNTIME_LIB_SRCS`) — never `smoke_main.c`, which defines its own `main`
and would collide with the emitted module's. `print.c` and `shadow.c`
are not called by any emitted code yet (`src/emit/lower.mnd` only lowers
`Int` — no `print`/`println`, and every `shadow-push`/`shadow-pop` call
is recognised as a no-op and skipped rather than emitted as a real
call); they link in unused, which is fine — see their header comments.

## Build and run the smoke test

```bash
make runtime-smoke
```

This compiles `alloc.c` + `panic.c` + `smoke_main.c` with `clang` (from
`PATH` — see the pin note below), links `runtime/build/smoke`, and runs it.
It allocates a couple of objects, round-trips a tagged `Int` through them,
and prints `ok`.

`make runtime-clean` removes `runtime/build/`.

## Toolchain pin

The Makefile pins `CC` to `clang`, resolved via `PATH` at recipe time —
not `/usr/bin/cc`, and not a hardcoded absolute path. Override with
`make CC=... runtime-smoke` if needed.

## Fixtures: a minimal bitcode program

`fixtures/ret0.c` is `int main(void) { return 0; }`. Two artifacts are
derived from it:

- `fixtures/ret0.ll` — **textual IR, for humans to read.** It is a debug
  reference only; nothing in the build reads it.
- `fixtures/ret0.bc` — **the golden binary sample.** This is the file that
  matters: the smallest valid piece of bitcode the Menard emitter's output
  will eventually be checked against for *structure* (module flags,
  function definition, `ret`), not for exact bytes — clang's output carries
  target/toolchain metadata the emitter will never produce.

Regenerate both from the C source (do not hand-edit either):

```bash
clang -S -emit-llvm -o runtime/fixtures/ret0.ll runtime/fixtures/ret0.c
clang -c -emit-llvm -o runtime/fixtures/ret0.bc runtime/fixtures/ret0.c
```

`llvm-as runtime/fixtures/ret0.ll -o runtime/fixtures/ret0.bc` produces a
byte-identical `.bc` to the second command above, and is the other
documented path (per spec §2.15, `mn`'s toolchain calls are argv vectors,
never a shell string — the same discipline applies to how these fixtures
are (re)built).

Sanity-check a regenerated fixture actually runs:

```bash
clang runtime/fixtures/ret0.bc -o /tmp/ret0 && /tmp/ret0; echo $?   # 0
```

Note: `ret0.ll` / `ret0.bc` embed the local clang version, SDK version and
target triple, so they will differ across machines and toolchain upgrades.
That is expected — they are a reference pair, not a cross-platform fixture.
