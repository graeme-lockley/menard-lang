# `src/` — the Menard compiler, written in Menard

This is **the** compiler (ADR 15: one compiler, written once). It is a
multi-module Menard program (ADR 14: no import cycles), run two ways:

- as **stage0**, interpreted by the Phase 1 host (`bun run
  host/src/cli/menard.ts run src/mn.mnd -- …`) — how `make` bootstraps
  `./mn`;
- as **stage1/stage2**, the native `./mn` binary stage0 (and then stage1)
  compiles from this same source — see the root [`README.md`](../README.md)
  and spec §3.5.

Nothing under `src/` is TypeScript, and nothing here is committed as a
binary: every run starts from this source, on the interpreter or on a
previously-built native compiler.

## Running it (stage0)

```bash
bun run host/src/cli/menard.ts run src/mn.mnd -- check <file.mnd>
bun run host/src/cli/menard.ts run src/mn.mnd -- emit  <file.mnd> [out.bc]
```

`check` reads, casing-checks, desugars and typechecks a program; `emit`
does the same and writes a bitcode module (see "Where the pipeline really
is today" below). `make hello-native` runs `emit` on `hello.mnd`, links the
result with `clang`, and runs it — the current end-to-end smoke test (root
`README.md`).

## Module layout

| Path | Role | Status |
| --- | --- | --- |
| `mn.mnd` | CLI entry point: argv parsing, `check`/`emit`/`build`/`run`/`inter` dispatch, the front-end pipeline, diagnostics reporting. `make` links this to `./mn` | Wired |
| `reader/ast.mnd` | `Ast` (the reader's output shape) and `Span` | Wired |
| `reader/read.mnd` | Source bytes → `Ast` forms (mirrors `host/src/reader/read.ts`) | Wired |
| `reader/print.mnd` | `Ast` forms → source text (round-trip printer) | Wired |
| `reader/casing.mnd` | Casing check (ADR 26: upper = type/ctor, lower = value) | Wired |
| `desugar/desugar.mnd` | Expands `and`/`or`/`cond`/`when`/`while` and `[e …]` / `[]` into `if`/`do`/`loop`/`recur` and `Cons`/`Nil` | Wired |
| `type/types.mnd` | `Type`/`Scheme`/`TypeDef`/`CtorInfo`, plus `type-equal`/`type-show` and the `is-showable`/`is-orderable` predicates (mirrors `host/src/type/types.ts`) | Wired |
| `type/check.mnd` | Typechecker for the phase-3 subset, including `spawn`. An `extern` registers the same scheme as a `defn` header | Wired |
| `close/close.mnd` | Closure conversion to heap closures (`mn_closure_new` / `mn_apply_*`) | Wired for the closures the compiler and the examples use |
| `root/root.mnd` | Inserts `shadow-push` / `shadow-pop` no-ops. Real §4.4 rooting is emitted by `emit/lower.mnd` | Wired — the lowerer roots may-collect functions; this pass's wrap is skipped |
| `derive/derive.mnd` | Generates `show` / `=` / `compare` / `dump` for user records and variants that a use site mentions | Wired for monomorphic user types whose fields print with builtin `show` |
| `derive/plan.mnd` | `describe-derives`: walks a program's `show`/`=`/`compare`/`dump` use sites and reports which types need which, with no typer in hand (spec §2.8.4's instantiation-site question) | Wired for the `--dump-after=derive` diagnostic (slice 2F) — analysis only, generates no code |
| `pool/pool.mnd` | Static pool: sorted `Str` and `Float` literals, plus a golden list of nullary-constructor mentions | Wired — the lowerer emits string globals from `pool-string-literals`. Nullary constructors stay the C static objects |
| `emit/llvm-ir.mnd` | `Item` (a small, already bitcode-shaped instruction set — `IConstI64`/`IAlloca`/`IBinop`/`ICmp2`/`ICast`/`IStore`/`ILoad`/`IBr`/`ICondBr`/`ICall`/`IRet`), `LFunc`/`LlvmModule`, and the opcode/predicate/type-index constants both `lower.mnd` and `bc-writer.mnd` share | Wired |
| `emit/bc-writer.mnd` | The real bit-level LLVM bitcode encoder (ADR 40): `BitSink`, block/record writer, `write-module-bc` (a full multi-function module from an `LlvmModule` — real types, constants, functions, DECLAREBLOCKS, and every `Item` variant's own `FUNC_CODE_INST_*` record) | Wired — writes real, valid, unwrapped bitcode for any number of `i64`-params-and-return functions plus one `main` (`() -> i32`), with real instructions, not just `ret i32 N` |
| `emit/lower.mnd` | Lowers the phase-3 subset (loops, match, strings, closures, maps, I/O) and emits shadow-stack rooting for may-collect functions. Refuses `Float` | Wired |
| `emit/bitcode.mnd` | `emit-program-bc`: the `emit` CLI's entry into code generation | Wired — runs pool collection, then delegates to `lower.mnd`, returning `Result Str Str` so a lowering failure becomes a clean CLI error rather than a crash |
| `tools/read-roundtrip.mnd` | Test harness (not part of the compiler): read → print → read → structural-equality | Wired |
| `tools/pool-dump.mnd` | Test harness (not part of the compiler): renders `pool/pool.mnd`'s collected entries as goldenable text | Wired |
| `util/result.mnd` | `result-bind`/`result-then` — `Result` plumbing shared by the reader, casing checker and emitter (ADR 6: no exceptions) | Wired |

"Wired" modules are exercised by `src/mn.mnd`'s pipeline today. "Stub" and
"Skeleton"/"Placeholder" modules exist so the pipeline's *shape* — reader →
casing → desugar → type → closure-convert → rooting-analyze → derive → emit
(spec §5's Phase 2 diagram) — is in place end to end, and so each later
slice has one module to grow into rather than a new one to wire up. Each
stub module says in its own header comment what it stands in for and what
replaces it.

## Where the pipeline really is today

`src/mn.mnd`'s front end runs: read → casing → desugar → typecheck →
closure-convert → rooting-analyze → plan-derives → emit. Type errors abort
before the later passes. `plan-derives` prepends `show`, `=`, `compare`, and `dump` for each user
record or variant a classifiable use site mentions. Real shadow-stack
rooting is in `emit/lower.mnd`. The `shadow-push` / `shadow-pop` wrap from
`root/root.mnd` is skipped there.

`emit` lowers the phase-3 subset, plus `Float` as a bytes object, to
bitcode. String globals come from `pool/pool.mnd`'s sorted literals.
`make check-fixed-point` is the self-host gate.

## Adding a slice

1. Pick the stub (or, once none remain, the next module) the slice replaces.
2. Give it a real body; keep its module comment's "what this stands in for"
   framing until the *whole* pipeline no longer needs it as a landmark.
3. If the slice changes what a `.bc` output looks like, add or update a
   fixture-comparison test under `tests/phase2/` (see
   `tests/phase2/emit-link.test.ts` for the emit → clang → run shape).
4. `bun run host/src/cli/menard.ts check src/<module>/<file>.mnd` typechecks
   the one module in isolation before running the full suite.
