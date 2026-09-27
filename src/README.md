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
| `desugar/desugar.mnd` | Expands `and`/`or`/`cond`/`when`/`while` into `if`/`do`/`loop`/`recur` (mirrors `host/src/desugar/desugar.ts`) | Wired |
| `type/types.mnd` | `Type`/`Scheme`/`TypeDef`/`CtorInfo`, plus `type-equal`/`type-show` and the `is-showable`/`is-orderable` predicates (mirrors `host/src/type/types.ts`) | Wired |
| `type/check.mnd` | Typechecker: two-pass `defn` scheme collection, `let`/`do`/`if`/`match`/`loop`/`recur`/`fn`, builtin Int/Bool/Str/Unit ops, unification (mirrors the Phase 2 critical subset of `host/src/type/check.ts`) | Wired — see its header comment for the slice's TODOs (`extern` typing, cross-module import typing, `spawn`, full equatable predicate) |
| `close/close.mnd` | Closure conversion (spec §2.6, §4.4) | Simplified for slice 2E — lambda-lifts a bare `(let f (fn …))` + its call sites into a top-level `defn` (Int-only params/captures); the full heap-allocated-closure scheme is future work (see its header comment) |
| `root/root.mnd` | Rooting analysis / shadow-stack insertion (spec §4.4) | Simplified for slice 2E — wraps every `defn` body with calls to two new Unit no-op `defn`s (`shadow-push`/`shadow-pop`), proving the call-site shape without a real collector to root anything for yet (see its header comment) |
| `derive/derive.mnd` | Derive-engine entry point: `plan-derives`, wired in `main.mnd` | **Stub** — identity on the form list; per-instantiation code generation (spec §2.8.1, §2.8.4) is future work — see `derive/plan.mnd` for the one real piece of analysis landed so far |
| `derive/plan.mnd` | `describe-derives`: walks a program's `show`/`=`/`compare`/`dump` use sites and reports which types need which, with no typer in hand (spec §2.8.4's instantiation-site question) | Wired for the `--dump-after=derive` diagnostic (slice 2F) — analysis only, generates no code |
| `pool/pool.mnd` | Static pool collection (spec §2.2.1/ADR 38): walks a program for `Str` literals and nullary-constructor mentions, dedups and sorts by byte content | Wired — collected on every real `emit` (`emit/bitcode.mnd`'s `run-pool-collection`) and asserted goldenly in `tests/phase2/pool.test.ts`, but the result is computed and discarded; nothing downstream (`lower.mnd`'s real instruction selector only handles `Int`, not `Str`/constructor values yet) consumes a pool entry, and none of its bytes reach the module image — future work |
| `emit/llvm-ir.mnd` | `Item` (a small, already bitcode-shaped instruction set — `IConstI64`/`IAlloca`/`IBinop`/`ICmp2`/`ICast`/`IStore`/`ILoad`/`IBr`/`ICondBr`/`ICall`/`IRet`), `LFunc`/`LlvmModule`, and the opcode/predicate/type-index constants both `lower.mnd` and `bc-writer.mnd` share | Wired |
| `emit/bc-writer.mnd` | The real bit-level LLVM bitcode encoder (ADR 40): `BitSink`, block/record writer, `write-module-bc` (a full multi-function module from an `LlvmModule` — real types, constants, functions, DECLAREBLOCKS, and every `Item` variant's own `FUNC_CODE_INST_*` record) | Wired — writes real, valid, unwrapped bitcode for any number of `i64`-params-and-return functions plus one `main` (`() -> i32`), with real instructions, not just `ret i32 N` |
| `emit/lower.mnd` | Lowers a typechecked, desugared program to the `Item`s `bc-writer.mnd` emits: finds top-level `defn main -> Int`, and lowers `Int` literals, `+ - * / %`, comparisons (`if`'s test only), `if`/`let`/`do`, calls to other top-level `Int`-only `defn`s (including lambda-lifted ones), and standalone top-level `println`/`print` of `Str` literals/`Int`s and `write` to fd 1/2 (prepended into `main`'s body as effect steps) to real `alloca`/`store`/`load`/`binop`/`icmp`/`br`/`call`/`ret` instructions over the tagged-`Int` ABI (spec §2.2/§3.4), plus real LLVM string globals and calls into the runtime's `mn_write_stdout`/`mn_print_i64`/`mn_write_stderr` | Wired for the Int/if/let/calls subset plus `println`/`print`/`write` — errors (no `emit`) if `main` is missing/wrong-arity, or its body needs `loop`/`recur`, `match`, `fn`, or any other non-`Int` value; see its header comment's "Scope" for exactly what's deferred and why |
| `emit/bitcode.mnd` | `emit-program-bc`: the `emit` CLI's entry into code generation | Wired — runs pool collection, then delegates to `lower.mnd`, returning `(Result Str Str)` so a lowering failure becomes a clean CLI error rather than a crash |
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

`src/mn.mnd`'s `check`/`emit` front end runs: read → (dump `reader`) →
casing → desugar → (dump `desugar`) → typecheck → (dump `type`) →
closure-convert → (dump `close`) → rooting-analyze → (dump `root`) →
plan-derives → (dump `derive`) → `on-ok`. Type errors still abort before
any of the post-type passes or `emit`. `derive/derive.mnd`'s
`plan-derives` is still an identity stub (`derive/plan.mnd`'s
`describe-derives`, run only for `--dump-after=derive`, is analysis, not
a form transform); `close` and `root` got simplified (not identity)
bodies in slice 2E — see their header comments for exactly what each
does and does not handle yet.

`close` and `root` are no longer identity — see their header comments —
but neither changes what any *existing* fixture computes, since both
simplified passes preserve a body's value exactly (lambda lifting by
construction; rooting's wrapping is skipped entirely by `emit/lower.mnd`
recognising `shadow-push`/`shadow-pop` as the structural no-ops they
are).

`emit` (via `emit/bitcode.mnd` → `pool/pool.mnd` + `emit/lower.mnd` →
`emit/llvm-ir.mnd`'s `Item`s → `emit/bc-writer.mnd`) runs the static pool
collector over the program's forms (computed and discarded — nothing
consumes a pool entry yet, see that module's table row above) and then
does real instruction selection for the accepted subset: every top-level
`Int`-only `defn` (params and return both bare `Int`), reachable from a
zero-arg `main -> Int`, whose body is built from `Int` literals,
`+ - * / %`, comparisons (`if`'s test only), `if`/`let`/`do`, and calls
to other such `defn`s (including lambda-lifted `__lamN`s) — plus
standalone top-level `println`/`print` of `Str` literals/`Int`s and
`write` to fd 1/2, which are collected and prepended into `main`'s own
body as effect steps that don't feed its `Int` result. `lower.mnd`
lowers `Int`/if/let/calls to real `alloca`/`store`/`load`/`binop`/
`icmp`/`br`/`call`/`ret` instructions over the tagged-`Int` ABI (spec
§2.2/§3.4: `t(v) = (v<<1)|1`; `+`/`-` free plus a one-instruction fixup;
`*`/`/`/`%` untag/native-op/retag; `main` alone untags and truncates to
`i32` before its own `ret`), and `println`/`print`/`write` to real LLVM
string globals plus calls into the runtime's `mn_write_stdout`/
`mn_print_i64`/`mn_write_stderr` (fd-1/fd-2 print helpers), and hands the
result to `bc-writer.mnd`'s `write-module-bc`, which serializes those
string globals, the three runtime extern declarations, any number of
`i64`-params-and-return functions, and `main`'s `() -> i32` — real
instructions that *compute* the result and *produce* the program's
actual output, not `define i32 @main() { ret i32 N }` for a constant `N`
folded at compile time. `loop`/`recur`, `match`, `fn` left over from a
failed lambda-lift, and any other non-`Int` value are a clean, documented
`Err` instead (see `emit/lower.mnd`'s header comment's "Scope" for
exactly what and why); that is future work (see the root
[`README.md`](../README.md#status)'s Status section for exactly what's
left before Phase 3). `make hello-native` and `make ret-native` both
prove the *bitcode is valid, linkable, and carries the program's actual
computed result* (now including `hello.mnd`'s real "Hello, world!"
output) — see `tests/phase2/oracle.test.ts` for the interp↔native oracle
this proves it on (asserting the emitted module's `llvm-dis` text
actually contains the instruction its fixture claims, and that interp
and native stdout agree byte-for-byte for the `println` fixture — not
just the right exit code), across every fixture in
`tests/phase2/oracle/`.

## Adding a slice

1. Pick the stub (or, once none remain, the next module) the slice replaces.
2. Give it a real body; keep its module comment's "what this stands in for"
   framing until the *whole* pipeline no longer needs it as a landmark.
3. If the slice changes what a `.bc` output looks like, add or update a
   fixture-comparison test under `tests/phase2/` (see
   `tests/phase2/emit-link.test.ts` for the emit → clang → run shape).
4. `bun run host/src/cli/menard.ts check src/<module>/<file>.mnd` typechecks
   the one module in isolation before running the full suite.
