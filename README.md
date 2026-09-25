# Menard

A small, statically typed, self-hosting language that compiles to LLVM IR — with
first-class closures, explicit type parameters, and a precise garbage collector.

Named for Borges' *Pierre Menard, Author of the Quixote*: there is **one**
compiler, written once, in Menard, and the headline criterion is that two
entirely different executions of it arrive at the same text. The reference
interpreter (TypeScript on Bun) runs the compiler on its own source; the native
binary built from that output compiles the same source again; and the two must
emit **byte-identical** IR — `ir0 == ir1`. That gate proves the two executions
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
| stage1 | the native binary built from stage0's IR for the compiler's own source |
| stage2 | the native binary built from stage1's IR for the same source |

The gate is `ir0 == ir1`: stage0 and stage1 are the same program given the same
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

**Phase 0** (reader, printer, spans, casing) is complete. **Phase 1** is in
progress: the reference interpreter runs as the semantic oracle, with desugar and
typer, production diagnostics (`diagnose` / `formatDiagnostic`), builtins
(`Map`, `StringBuffer`, …), a virtual filesystem host, and a minimal prelude.
What remains is making it fit to host the compiler as stage0 — modules, the real
filesystem and `argv`, recursion that does not depend on the JavaScript stack,
a persistent `Map`, and throughput — tracked in the
[issue list](https://github.com/graeme-lockley/menard-lang/issues).

Phase 2 writes the compiler in Menard, on the interpreter; phase 3 self-hosts
(`ir0 == ir1`); phase 4 adds the collector — see §5 of the spec.

## Build

### Prerequisites

- [Bun](https://bun.sh) **1.4.2** (pinned in `host/package.json`)
- Make

### Setup

```bash
cd host
bun install --frozen-lockfile
cd ..
```

### Test and typecheck

```bash
make test        # unit, corpus, fuzz, semantic, negative diagnostics, io
make typecheck   # tsc --noEmit
make ci          # typecheck + test (mirrors GitHub Actions)
```

### Check / run a program (Phase 1 host CLI)

```bash
bun run host/src/cli/menard.ts check path/to/file.mnd
bun run host/src/cli/menard.ts run path/to/file.mnd
bun run host/src/cli/menard.ts run --show-result path/to/file.mnd
```

`run` writes `print` / `println` / `dump` **live** to the process streams.
`--show-result` also prints the final non-`Unit` value (REPL-style).

Exit codes: `0` ok, `1` program error/panic, `2` usage or I/O fault.

Or from `host/`:

```bash
bunx tsc --noEmit -p tsconfig.json
bun test ../tests
```

### Repository layout (current)

| Path | Role |
| --- | --- |
| `docs/` | Language specification and decision record |
| `host/` | TypeScript on Bun — the reference interpreter: oracle and stage0 host |
| `host/src/reader/` | Shared reader, AST, printer, casing |
| `host/src/diagnostic/` | Diagnostic model and formatter |
| `host/src/desugar/` | Special-form sugar |
| `host/src/type/` | Typechecker |
| `host/src/interp/` | Reference interpreter + `diagnose`/`run` |
| `host/src/builtins/` | Map, StringBuffer (TS) |
| `host/src/host/` | Virtual filesystem Host |
| `host/src/cli/` | `check` / `run` CLI |
| `prelude/` | Minimal Menard prelude |
| `tests/` | Unit, corpus, semantic, negative, io |
| `.github/workflows/` | CI |

The compiler itself will live in `src/` (Menard), with the C runtime in
`runtime/`. A full bootstrap (`make bootstrap`: interpreter → stage0 → stage1 →
stage2) arrives with self-hosting in phase 3.
