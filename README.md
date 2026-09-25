# Menard

A small, statically typed, self-hosting language that compiles to LLVM IR — with
first-class closures, explicit type parameters, and a precise garbage collector.

Named for Borges' *Pierre Menard, Author of the Quixote*: the project's headline
criterion is that two independently written compilers (one in TypeScript, one in
Menard) must emit **byte-identical** output for the same source. Agreement is
proven by `stage2 == stage3`. That gate proves the implementations *agree*; a
reference interpreter is the oracle for *correctness*.

## Purpose

Menard asks one question: can a language small enough for one person to finish
express its own compiler, target LLVM, and still have closures and a real
collector?

Every feature is judged by finishability. The frontend is s-expressions, type
parameters are declared rather than inferred, the syntax is closed (no macros),
and the emitter is deliberately naive — LLVM does the optimisation work.
Closures and the collector are isolated and deferred until self-hosting works.

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

**Phase 0** is in place: a byte-oriented s-expression reader and printer in
TypeScript (Bun), with spans, `!` hygiene, form-aware casing checks, corpus
round-trips, and fuzz. Later phases add the reference interpreter, the stage0
LLVM compiler, self-hosting, and the collector — see §5 of the spec.

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
make test        # reader unit tests, corpus, fuzz
make typecheck   # tsc --noEmit
make ci          # typecheck + test (mirrors GitHub Actions)
```

Or from `host/`:

```bash
bunx tsc --noEmit -p tsconfig.json
bun test ../tests
```

### Repository layout (current)

| Path | Role |
| --- | --- |
| `docs/` | Language specification and decision record |
| `host/` | TypeScript on Bun — stage0 and (soon) the interpreter |
| `host/src/reader/` | Shared reader, AST, printer, casing |
| `tests/` | Unit tests and `.mnd` corpus fixtures |
| `.github/workflows/` | CI |

A full bootstrap (`make bootstrap`) arrives with self-hosting in later phases.
