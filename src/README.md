# `src/` — the Menard compiler, written in Menard

This is the compiler. It is a multi-module Menard program. The reference interpreter runs it as stage0, and the native `./mn` binary is that same source, linked. `make` builds `./mn` from here. Nothing under `src/` is TypeScript, and no compiler binary is committed.

```bash
bun run host/src/cli/menard.ts run src/mn.mnd -- check <file.mnd>
bun run host/src/cli/menard.ts run src/mn.mnd -- emit  <file.mnd> [out.bc]
./mn check <file.mnd>
./mn build <file.mnd> -o <binary>
```

`check` stops after typechecking. `emit` writes a bitcode module. `build` emits, links the runtime with clang, and renames the binary into place.

## Pipeline

`src/mn.mnd` runs one front end:

1. **Read** (`reader/read.mnd`) turns source bytes into `Ast` forms. A parse error reports a span and exits.
2. **Casing** (`reader/casing.mnd`) checks that types and constructors start upper and values start lower.
3. **Desugar** (`desugar/desugar.mnd`, `desugar/rest.mnd`) lowers `cond`, `if`, `match`, `loop`, pipes, `?`, list sugar, and rest parameters to the core.
4. **Modules** (`modules/graph.mnd`). A file with imports is flattened into one program, and private names are renamed. A file without imports is stamped and prepared on its own.
5. **Typecheck** (`type/check.mnd`, `type/types.mnd`). A type error stops the pipeline.
6. **Close** (`close/close.mnd`) turns closures into heap closures.
7. **Root** (`root/root.mnd`) records where a collection may run. The lowerer emits the real shadow-stack pushes and pops.
8. **Derive** (`derive/plan.mnd`, `derive/derive.mnd`) adds `show`, `=`, `compare`, and `dump` for each user record or variant a use site mentions.
9. **Lower** (`pool/pool.mnd`, `emit/lower.mnd`, `emit/llvm-ir.mnd`, `emit/bc-writer.mnd`, `emit/bitcode.mnd`). Literals and nullary constructors go into the static pool. The lowerer emits an LLVM module, and the bitcode writer encodes it.

`check`, `build`, and `run` compile each module into `~/.menard` and reuse a fresh interface instead of parsing it again. `emit` writes one flat bitcode file, which is what the fixed-point comparison reads. `diag/report.mnd` formats the spans. `test/run.mnd` is `mn test`: it discovers `@test` lines and runs them.

## Modules

| Path | Role |
| --- | --- |
| `mn.mnd` | CLI: `check`, `emit`, `build`, `run`, `test`, `inter` |
| `reader/ast.mnd` | `Ast` and `Span` |
| `reader/read.mnd` | Source bytes to forms |
| `reader/print.mnd` | Forms back to source text |
| `reader/casing.mnd` | Upper for types and constructors, lower for values |
| `desugar/desugar.mnd` | Surface forms to the core |
| `desugar/rest.mnd` | Rest parameters |
| `modules/graph.mnd` | Import graph, flattening, runtime-module names |
| `type/types.mnd` | `Type`, `Scheme`, equality, `show`, orderability |
| `type/check.mnd` | Typechecker |
| `close/close.mnd` | Closure conversion |
| `root/root.mnd` | Rooting analysis |
| `derive/plan.mnd` | Which user types need `show`, `=`, `compare`, `dump` |
| `derive/derive.mnd` | The generated functions |
| `pool/pool.mnd` | Static pool: dedup by bytes, sort by bytes |
| `emit/llvm-ir.mnd` | The instruction set the lowerer and the writer share |
| `emit/lower.mnd` | Menard to that instruction set, including shadow-stack rooting |
| `emit/bc-writer.mnd` | LLVM bitcode encoding |
| `emit/bitcode.mnd` | `emit`'s entry: pool, then lower |
| `cache/cache.mnd`, `cache/sep.mnd` | `~/.menard` interfaces and objects |
| `diag/report.mnd` | Diagnostic text |
| `test/run.mnd`, `test/doctest.mnd` | `mn test` and `@test` lines |
| `tools/` | Round-trip, pool dump, and doc helpers used by tests |
