# Menard

A small, statically typed, self-hosting language that compiles to LLVM bitcode — with
first-class closures, explicit type parameters, and a precise garbage collector.

Named for Borges' *Pierre Menard, Author of the Quixote*: there is **one**
compiler, written once, in Menard, and the headline criterion is that two
entirely different executions of it arrive at the same text. The reference
interpreter (TypeScript on Bun) runs the compiler on its own source; the native
binary built from that output compiles the same source again; and the two must
emit **byte-identical** bitcode — `bc0 == bc1`. That gate proves the two executions
*agree*; the interpreter is also the oracle for *correctness*.

## Purpose

Menard asks one question: can a language small enough for one person to finish
express its own compiler, target LLVM, and still have closures and a real
collector?

Every feature is judged by finishability. The frontend is s-expressions, type
parameters are declared rather than inferred, the syntax is closed (no macros),
and the emitter is deliberately naive — LLVM does the optimisation work.
Closures and the collector are isolated and deferred until self-hosting works.
And there is no second compiler to keep in step: the bootstrap is the
interpreter running the one compiler, from source.

## The bootstrap

| Stage | What it is |
| --- | --- |
| stage0 | the compiler (`src/`, Menard) running on the reference interpreter |
| stage1 | the native binary built from stage0's bitcode for the compiler's own source |
| stage2 | the native binary built from stage1's bitcode for the same source |

The gate is `bc0 == bc1`: stage0 and stage1 are the same program given the same
input, so their output must match, and `stage2` is then `stage1` byte for byte.
No compiler binary is committed; every bootstrap starts from source. See §3.5 of
the spec.

The full design lives in [`docs/menard-spec.md`](docs/menard-spec.md); standing
decisions are in [`docs/decisions.md`](docs/decisions.md).

## The language

- **Surface:** s-expressions (`.mnd` files). No infix, no significant whitespace,
  no macros — ever.
- **Types:** static; primitives plus records, variants, and explicit type
  parameters. Instantiation, not Hindley–Milner inference.
- **Values:** one 64-bit word each; `Int` is 63-bit tagged; immutability by
  default, with exactly two reference types (`Ref`, `StringBuffer`).
- **Control:** expression-oriented `if` / `match` / `loop`–`recur`; no
  exceptions; results via `Result`.
- **Runtime (planned):** precise tag-based GC, shadow-stack rooting, C11 runtime
  linked by clang.

```lisp
(defn (tree-size [a]) (t: (Tree a)) -> Int
  (match t
    (Empty)     0
    (Leaf _)    1
    (Node l r)  (+ 1 (+ (tree-size l) (tree-size r)))))
```

## Status

**Phase 0** and **Phase 1** are complete. The reference interpreter is the
semantic oracle and stage0 host: modules, the tier-0 seam (real filesystem and
`argv`), continuation-stack evaluation, a persistent `Map`, production
diagnostics, and a build-host benchmark in CI. Issues
[#1](https://github.com/graeme-lockley/menard-lang/issues/1)–[#10](https://github.com/graeme-lockley/menard-lang/issues/10)
are closed.

**Phase 2 and Phase 3 are complete.** The emitter lowers `loop`/`recur`,
Bool/Unit immediates, `List`/`Maybe`/`Result` and `match`, `Str` /
`StringBuffer` / `Ref`, heap closures, persistent `Map`, and tier-0 I/O,
including import-graph flatten. See [`examples/`](examples/) and
`tests/phase2/oracle.test.ts`. **The Phase 3 gate is green.**
`make check-fixed-point` checks
`bc0 == bc1`, `stage1 == stage2`, and that `build/fp/stage1 build` (the
Menard driver: in-process emit, `spawn` of the recorded `cc`, `rename`
into place) produces a binary byte-identical to `./mn build` on the same
`-o` path. `./mn` is that native driver, built from `src/mn.mnd`. `emit`
spawns nothing.

**Phase 4 is complete.** `mn_alloc` bumps a 256 KiB nursery. A minor
collection copies young survivors into old space from the shadow stack and
the remembered set; it does not scan old space. A major mark-sweep runs
only after old space crosses a growth threshold, and static objects stay
leaves. On a native compile of `src/mn.mnd`, `mn_gc_stats` reported a
last minor pause of 143µs with old space at about 32 MiB (first minor 35µs
at 75 KiB; minor max 441µs). Five majors ran, the longest about 8 ms.
`MENARD_GC_STRESS` and `MENARD_HEAP_VERIFY` cover the oracle corpus and
`examples/heap-churn.mnd`.

## Build

### Prerequisites

- [Bun](https://bun.sh) **1.4.2** (pinned in `host/package.json`)
- Make
- **clang**, for linking the compiler's bitcode output and for
  `make runtime-smoke` — pinned via the Makefile's `CC` (looked up on `PATH`
  at recipe time, never hardcoded; see the Makefile's `CC` comment). ADR 40:
  Menard's compiler emits `.bc` and never shells out to `llvm-as` itself —
  clang is the only toolchain program the build ever invokes, and only to
  link. Developed against:

  ```
  $ clang --version
  Homebrew clang version 23.1.2
  Target: arm64-apple-darwin27.0.0
  ```

  Any reasonably recent clang (LLVM 17+) should read the bitcode this
  project produces; `runtime/README.md` has the fixture-regeneration
  commands if a different clang's output needs to be captured as a golden
  sample.

### Setup

```bash
cd host
bun install --frozen-lockfile
cd ..
```

### Test and typecheck

```bash
make test        # unit, corpus, fuzz, semantic, negative, io, build-host bench
make typecheck   # tsc --noEmit
make ci          # typecheck + test (mirrors GitHub Actions)
```

### `mn` — the native driver

```bash
make                                 # compile src/mn.mnd → ./mn
./mn build path/to/file.mnd          # emit bitcode, link → build/<name>
./mn build path/to/file.mnd -o out   # same, write binary to out
./mn run   path/to/file.mnd          # build, then execute
./mn run   path/to/file.mnd -- a b   # build, run with argv a b
./mn inter path/to/file.mnd          # reference interpreter only
./mn inter path/to/file.mnd --show-result
```

`make` bootstraps `./mn` with the interpreter (stage0) and links it with
clang. After that, `build` / `run` emit in-process and spawn the recorded
`cc`. `inter` still spawns the Phase 1 host. Override the linker with `CC`
or `MENARD_CC`, and the bootstrap host with `MENARD_BUN`.

### Check / run a program (Phase 1 host CLI)

```bash
bun run host/src/cli/menard.ts check path/to/file.mnd
bun run host/src/cli/menard.ts run path/to/file.mnd
bun run host/src/cli/menard.ts run --show-result path/to/file.mnd
bun run host/src/cli/menard.ts run path/to/file.mnd -- arg1 arg2
```

`run` writes `print` / `println` / `dump` **live** to the process streams.
`--show-result` also prints the final non-`Unit` value (REPL-style).
Arguments after `--` become `(arg)` / `(arg-count)` — the stage0 shape is
`run src/mn.mnd -- file.mnd`.

Exit codes: `0` ok, `1` program error/panic, `2` usage or I/O fault.

Or from `host/`:

```bash
bunx tsc --noEmit -p tsconfig.json
bun test ../tests
```

### Emit and link a native binary (Phase 2 smoke)

```bash
make hello-native   # stage0 emit -> clang link -> run; prints "Hello, world!" and exit 0
```

This runs the compiler (`src/mn.mnd`, in Menard, interpreted by the Phase 1
host — stage0) in `emit` mode over `hello.mnd`, links the resulting
`build/hello.bc` against the runtime (`RUNTIME_LIB_SRCS`) with clang, and runs
`build/hello`. `hello.mnd`'s standalone top-level `(println "Hello,
world!")` is real, lowered instruction selection (see `src/emit/lower.mnd`'s
header comment for exactly what `println`/`print`/`write` and the
Int/if/let/calls subset lower to) calling into the runtime's fd-1 print
helpers (`runtime/src/print.c`), not a folded exit code — `make
runtime-smoke` (below) is the C runtime's own smoke test; neither needs the
other yet.

### Repository layout (current)

| Path | Role |
| --- | --- |
| `docs/` | Language specification and decision record |
| `host/` | TypeScript on Bun — the reference interpreter: oracle and stage0 host |
| `host/src/reader/` | Shared reader, AST, printer, casing |
| `host/src/diagnostic/` | Diagnostic model and formatter |
| `host/src/desugar/` | Special-form sugar |
| `host/src/type/` | Typechecker |
| `host/src/interp/` | Evaluator, modules, pipeline (`diagnose` / `run`) |
| `host/src/builtins/` | Map, StringBuffer (TS) |
| `host/src/host/` | Virtual + real FS Host, live sinks |
| `host/src/cli/` | `check` / `run` CLI |
| `prelude/` | Minimal Menard prelude |
| `src/` | Compiler (Menard) — Phase 2. See [`src/README.md`](src/README.md) for the module layout and the stage0 command |
| `runtime/` | C11 runtime (leaking allocator in Phase 2) |
| `tests/` | Unit, corpus, semantic, negative, io |
| `tests/bench/` | Build-host benchmark (CI time budgets) |
| `tests/phase2/` | Runs `src/` under the Phase 1 host as stage0 — reader round-trip, `check`/`emit` CLI behaviour, emit→clang→run |
| `.github/workflows/` | CI |

The compiler itself will live in `src/` (Menard), with the C runtime in
`runtime/`. A full bootstrap (`make bootstrap`: interpreter → stage0 → stage1 →
stage2) arrives with self-hosting in phase 3.
