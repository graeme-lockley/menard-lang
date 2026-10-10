# Menard

A small, statically typed language with closures, pattern matching, and a precise garbage collector. Programs compile to LLVM bitcode. The compiler is written in Menard.

```
import std/int as Int
import std/list as List
import std/string as String

pub let add(input: Str) -> Int {
  let tokens =
    if (input == "") -> [] | String.split-using([",", "\n"], input)
  tokens |> List.map(Int.parse) |> List.filter(fn (n) = n <= 1000) |> List.sum()
}
```

The full string calculator, with custom separators and a `Result` of every negative, is [examples/sc.mnd](examples/sc.mnd). Run its tests with `./mn test examples/sc.mnd`.

## The language

- **Values and functions.** Immutable by default. `|>` fills the last argument of a call, so `xs |> List.map(f)` is `List.map(f, xs)`. `?` fills in a missing `Maybe`: `xs |> List.head() ? 0`.
- **Control.** `cond` lays tests out. `if` is an inline value. `match` is exhaustive. `loop` and `recur` are the loop. There are no exceptions: failure is a `Result`.
- **Types.** `Int`, `Float`, `Bool`, `Char`, `Str`, records, and variants. Type parameters are written at the definition (`map[a, b]`) and filled in at the use. No inference, no macros.
- **Modules.** One file is one module. `import std/list as List` qualifies the exports. `pub` publishes a name; everything else is private.
- **The library.** Lists, maps, strings, characters, maybe, and result, in [docs/stdlib.md](docs/stdlib.md). Files, processes, and the console sit beside them.
- **`mn`.** `./mn run` compiles and runs a program. `./mn test` runs the `@test` lines in a module.

The guide is [docs/guide.md](docs/guide.md). The syntax reference is [docs/syntax.md](docs/syntax.md). The rules are [docs/menard-spec.md](docs/menard-spec.md).

## The compiler

There is one compiler, in `src/`, written in Menard. A reference interpreter in TypeScript runs that source. The bitcode it emits is linked into a native `./mn`, and that binary compiles the same source again. The two bitcode files are byte-identical: `bc0 == bc1`. The interpreter is also the oracle for whether a program means what it should. The gate shows that the two executions agree. The oracle shows that they are right.

`make bootstrap` builds that chain from a clean checkout. Nothing prebuilt is committed.

## Build

You need [Bun](https://bun.sh) 1.4.2, Make, and clang (LLVM 17 or newer). The project is developed against Homebrew clang 23 on arm64 macOS.

```bash
cd host && bun install --frozen-lockfile && cd ..
make                 # compile src/mn.mnd → ./mn
make test            # host unit, corpus, fuzz, semantic, and negative tests
make typecheck       # tsc --noEmit
make native-test     # ./mn test
make bootstrap       # interpreter, stage0, stage1, stage2, and the fixed point
```

```bash
./mn run examples/sc.mnd
./mn run examples/sc.mnd -- a b          # arguments after --
./mn examples/sc.mnd a b                 # a file path runs it; every following word is an argument
./mn build examples/loop-sum.mnd -o out
./mn test examples/sc.mnd
./mn test --show-output
./mn inter examples/sc.mnd               # reference interpreter
./mn inter examples/sc.mnd --show-result
```

`make` bootstraps `./mn` with the interpreter and links it with clang. After that, `build` and `run` emit bitcode in process and spawn the recorded `cc`. Override the linker with `CC` or `MENARD_CC`, and the bootstrap host with `MENARD_BUN`.

The host CLI is still there for the interpreter alone:

```bash
bun run host/src/cli/menard.ts check path/to/file.mnd
bun run host/src/cli/menard.ts run path/to/file.mnd
```

Exit codes: `0` ok, `1` a program error or panic, `2` usage or an I/O fault.

## Layout

| Path | What it is |
| --- | --- |
| [docs/guide.md](docs/guide.md) | The language, in reading order |
| [docs/stdlib.md](docs/stdlib.md) | The standard library |
| [docs/syntax.md](docs/syntax.md) | Syntax, and how the surface lowers |
| [docs/menard-spec.md](docs/menard-spec.md) | The specification |
| [docs/decisions.md](docs/decisions.md) | Why the language is shaped this way |
| `stdlib/` | The library, in Menard |
| `src/` | The compiler, in Menard |
| `runtime/` | The C runtime: nursery collector, shadow stack, strings, maps |
| `host/` | The reference interpreter |
| `examples/` | Short programs |
| `tests/` | Host tests, the corpus, and the fixed-point oracle |
