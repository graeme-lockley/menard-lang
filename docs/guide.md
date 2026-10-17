# An Introduction to Menard

Menard is a small, statically typed language. Values are immutable by default.
There are no exceptions: failure is a `Result`. Programs compile to LLVM
bitcode. The compiler is written in Menard.

This guide will:

- Teach you the core forms of the language.
- Show how to structure modules, handle failure, and run programs with `mn`.
- Leave you able to read the examples and write small programs of your own.

It is a tour, not the contract. The rules, with their edge cases, are in
[menard-spec.md](menard-spec.md). The syntax in full is in
[syntax.md](syntax.md). The library, function by function, is in
[stdlib.md](stdlib.md).

## A first program

`add` sums the numbers in a string. Commas and newlines separate them. A
number above 1000 is left out. A negative is not summed: the error is every
negative, in the order they appeared.

```
import std/int as Int
import std/list as List
import std/string as String

pub let add(input: Str) -> Result Int (List Int) {
  let tokens =
    if (input == "") -> [] | String.split-using([",", "\n"], input)

  let numbers = tokens |> List.map(Int.parse) |> List.filter(fn (n) = n <= 1000)

  if (numbers |> List.any(is-negative)) ->
    Err(numbers |> List.filter(is-negative)) |
    Ok(List.sum(numbers))
}

let is-negative(n: Int) -> Bool =
  n < 0
```

A few things to notice:

- `import … as List` qualifies the exports. `List.map` is a function, not a
  method.
- `|>` passes the value on the left as the **last** argument of the call on
  the right. `tokens |> List.map(Int.parse)` is `List.map(Int.parse, tokens)`.
  The parentheses show the arguments that are already filled.
- The return type is `Result Int (List Int)`: either the sum, or the list of
  negatives. There is no throw.

The full string calculator, with custom separators, lives in
[examples/sc.mnd](../examples/sc.mnd). Run its tests with:

```bash
./mn test examples/sc.mnd
```

The rest of this guide unpacks the pieces so that program no longer looks
foreign.

## Values and functions

The smallest pieces are values: `42`, `true`, `"hello"`, `'A'`.

`Int` is one integer type. `Str` is a sequence of bytes, not necessarily
text. `Char` is one Unicode scalar. `Float` is a boxed floating-point number;
its arithmetic is spelled `f+`, `f-`, `f*`, `f/`, not infix `+`.

A function names its arguments and its result.

```
let greet(name: Str) -> Str =
  String.concat("Hello, ", name)
```

A block is a sequence of expressions. The last one is the result.

```
let greet(name: Str) -> Str {
  let hello = "Hello, "
  String.concat(hello, name)
}
```

`fn` is a function with no name. It is a value, and it can close over the
names around it.

```
let add-to(n: Int) -> (Int) -> Int =
  fn (m) = n + m
```

`add-to(40)` returns a function that adds forty. That returned function still
sees `n`.

Parameter types and the return type on a `fn` are present or absent
together: write both, or write neither. When neither is written and the
`fn` is passed as an argument, the checker uses the callee's expected
function type, so projections and patterns see those types.

```
let join-path = fn (dir: Str, name: Str) -> Str =
  String.concat(dir, "/", name)
```

Parameters may use the same binders as `let` and `match`: names, `_`, and
tuple patterns.

```
let add-pair = fn ((x, y)) = x + y
```

A heap closure (an anonymous `fn`, or any function that captures a name)
takes at most eight arguments. More than that is a compile error. Named
top-level functions have no such limit on the direct-call path.

Values are immutable. Updating a list or a map gives you a new one. The two
exceptions are a `Ref` cell and a `StringBuffer`; those are shared, and
changing one name is visible through the other. They come later, when a
program needs a cell.

There is no type inference at a polymorphic definition, no macros, and no
currying. What you write on a named definition is what the checker sees.

## Pipes and the last argument

The value you have in hand is the last parameter. That is why `List.map`
takes the function first and the list last, and why `String.drop` takes the
count first and the string last.

```
let positive(xs: List Int) -> List Int =
  xs |> List.filter(fn (n) = n > 0) |> List.map(fn (n) = n * 2)
```

Read a pipe left to right: start with `xs`, keep the positives, double each
one.

A bare name is not a pipe target. `xs |> List.map` is an error. Write
`xs |> List.map(f)`. The call on the right must already show the filled
arguments; the pipe supplies only the last.

## Making choices

### `cond` and `if`

`cond` is a list of tests. The first true arm is the result.

```
let sign(n: Int) -> Str =
  cond
    | n < 0 -> "negative"
    | n == 0 -> "zero"
    | else -> "positive"
```

`if` is the same choice written on one line. The test is in parentheses.

```
let abs(n: Int) -> Int =
  if (n < 0) -> -n | n
```

An `if` or `cond` with no else has type `Unit`. Anything else needs the else
arm.

### `match`

`match` takes a value apart. The arms cover every constructor.

```
let unwrap-or-zero(r: Result Int Str) -> Int =
  match (r)
    | Ok(n) -> n
    | Err(_) -> 0
```

```
let list-sum(xs: List Int) -> Int =
  match (xs)
    | [] -> 0
    | h :: t -> h + list-sum(t)
```

Several values can be matched together. Each arm's pattern is a parenthesized
list of the same length; no tuple is built for that form.

```
let same-len[a, b](xs: List a, ys: List b) -> Bool =
  match (xs, ys)
    | ([], []) -> true
    | (_ :: xt, _ :: yt) -> same-len(xt, yt)
    | (_, _) -> false
```

A value of product type is a single scrutinee: `match (p) | (x, y) -> …`.

A guard (`when`) refines an arm; it does not count as covering a constructor
on its own.

### `loop` and `recur`

`loop` names the values that change. `recur` starts the body again with new
ones.

```
let sum(xs: List Int) -> Int =
  loop (rest = xs, acc = 0)
    match (rest)
      | [] -> acc
      | n :: tail -> recur(tail, acc + n)
```

```
let sum-to(n: Int) -> Int =
  loop (i = 0, acc = 0)
    if (i > n) -> acc | recur(i + 1, acc + i)
```

There is no separate `while`. Recursion and `loop`/`recur` are the iteration.

## Types you define

### Products and records

A flat product is written with `*`. The value is a parenthesized comma list.
Components are selected with `.1`, `.2`, ….

```
let p = (1, "a")
p.1

let fst-of[a, b]((x, _): a * b) -> a =
  x
```

A record is a named product. The name is the constructor, and the fields are
selected with `.`.

```
pub record Counts {
  passed: Int
  failed: Int
}

let c = Counts(1, 0)
c.passed
```

### Variants

A variant is a sum. Each alternative is a constructor. Use one when a value
can be one of several shapes, and you want the type to say so.

```
type Color =
  | Red
  | Rgb(r: Int, g: Int, b: Int)
```

`Maybe`, `Result`, and `List` are variants the language already knows:

```
type Maybe[a] =
  | None
  | Some(a)

type Result[t, e] =
  | Ok(t)
  | Err(e)
```

`[]` is the empty list. `1 :: xs` is cons. `[1, 2, 3]` is that written out.

### Polymorphism

A polymorphic function declares its type parameters in brackets. The call
site does not. The checker fills them in from the arguments.

```
pub let map[a, b](f: (a) -> b, xs: List a) -> List b =
  match (xs)
    | [] -> []
    | h :: t -> f(h) :: map(f, t)
```

An alias is a name for a type, with no parameters of its own:
`alias Age = Int`. It disappears before anything is emitted; diagnostics
still show the name you wrote.

`show` prints a value as a string. Records and variants you define get a
derived `show`, along with equality and ordering. Prefer `print` /
`println` when the bytes should reach stdout; `show` is the quoted form.

## When things are missing or fail

There are no exceptions. Absence is a `Maybe`. Failure with a reason is a
`Result`.

### `Maybe`, `Result`, and `?`

`List.head` returns a `Maybe`: `Some` of the first element, or `None` when
the list is empty. `Result` carries either an `Ok` value or an `Err` value.

`?` unwraps either. The right-hand side runs only on `None` or `Err`. On
`Err`, the error payload is discarded; `?` only supplies a default.

```
let first-or-zero(xs: List Int) -> Int =
  xs |> List.head() ? 0

parsed ? 0
```

`?` binds looser than `|>`, so the pipe's result is what gets unwrapped.

Reach for `Maybe` when there is nothing useful to say about the missing
case. Reach for `Result` when the caller needs to know why. Prefer
`parsed ? 0` when you only need a default; use `Result.to-maybe` only when
a real `Maybe` is needed downstream.

```
let from-maybe[a, e](err: e, m: Maybe a) -> Result a e =
  match (m)
    | Some(v) -> Ok(v)
    | None -> Err(err)
```

The string calculator returns `Result Int (List Int)` so a bad input can
report every negative, not only that something went wrong.

`std/maybe` and `std/result` provide `map`, `and-then`, and related helpers.
Chain with `and-then` when the next step can fail too.

## Lists, maps, strings, characters

### Lists

`std/list` is the collection you reach for first. `map`, `filter`, `fold`,
`member`, `sum`, `head`, and `tail` all take the list last.

```
xs |> List.filter(fn (n) = n > 0) |> List.sum()
xs |> List.head() ? 0
xs |> List.append([4, 5])
```

`List.append(extra, xs)` is `xs` followed by `extra`. The pipe reads left to
right: start with `xs`, then append these.

### Maps

`std/map` is a persistent map. Keys are ordered, and iteration follows that
order, so two runs print the same keys. Updating a map returns a new map.

```
import std/map as Map

let ages = Map.empty() |> Map.set("ada", 36) |> Map.set("bea", 41)
ages |> Map.lookup("ada") ? 0
ages |> Map.merge(Map.singleton("ada", 37))
```

`Map.merge(overlay, base)` keeps `overlay` where the keys overlap. A map
literal is the same idea written in place. Later entries win.

```
let ages = { "ada" => 36, "bea" => 41 }
```

### Strings and characters

`std/string` works on bytes. The string is last.

```
s |> String.drop(2) |> String.trim()
s |> String.contains("ell")
String.words("a  b\nc")
```

`Int.parse` reads the leading digits and returns `0` when there are none.
`Int.from-str` succeeds only when the whole string is an integer, and it
returns a `Maybe`.

`std/char` is ASCII case and a few predicates, written with character
literals: `Char.is-digit('5')`, `Char.to-upper('q')`.

The functions are listed in [stdlib.md](stdlib.md).

## Programs that touch the world

A file named on the command line is the entry. Its `main` is the process
entry. Top-level forms in imported files still run; their `main` does not.

```
let main() -> Int {
  println("Hello, world!")
  0
}
```

`println` and `print` write showable values to standard output. `write`
sends raw bytes. `exit` sets the status. A panic prints to standard error
and exits `1`.

I/O that can fail returns a `Result`:

```
import std/io

let main() -> Int =
  match (read-file("examples/fixtures/echo-input.txt"))
    | Ok(s) ->
      {
        write(stdout, s)
        0
      }
    | Err(_) ->
      {
        println("could not read file")
        1
      }
```

Arguments after `--` are the program's. A file path in place of `run` does
the same thing, and every word after that path is an argument:

```bash
./mn run examples/echo-file.mnd -- a b
./mn examples/echo-file.mnd a b
```

A source file may open with `#!/usr/bin/env mn`, so the file itself can be
the command.

`std/basics` (`id`, `always`, `not`, `min`, `max`, `abs`, `clamp`) is already
in scope. Files, processes, and the environment sit in `std/fs`, `std/proc`,
and `std/sys`.

### Mutation, when you need a cell

Most programs never need this. When they do, `Ref` and `StringBuffer` are
the two mutable types.

```
let main() -> Int {
  let c = ref(0)
  let total =
    loop (i = 0)
      cond
        | i > 10 -> deref(c)
        | else ->
          {
            set!(c, deref(c) + i)
            recur(i + 1)
          }
  println("sum is ", total)
  0
}
```

`StringBuffer` is for building a string in place. The buffer comes first,
because it is the cell you are changing, not a value you pipe.

```
import std/string-buffer as Buf

let sb = Buf.new()
Buf.append!(sb, "hello")
Buf.take-str!(sb)
```

Neither `Ref` nor `StringBuffer` is showable or orderable. That keeps
mutable state out of maps and out of accidental printing.

## Modules

One file is one module. `pub` publishes a name. A name without `pub` stays
in the file.

```
import std/list as List
import "./lexer.mnd" as Lexer
pub import std/io (IoError)
```

`List.map` and `Lexer.read` are the exports. A bare `import std/list` brings
the names in directly. Two modules can both publish `map`; import one of
them qualified and they stay distinct.

`pub import` republishes names. With no list, every public name of that
module is republished, and a type brings its constructors. With a list, only
those names are republished. A public signature may name an imported public
type. It may not name a type this file declares and leaves private.

Imports do not cycle.

## Tests

A line that starts with `; @test` is a test. The left-hand side is an
expression; the right-hand side is the expected value.

```
; @test add("") => Ok(0)
; @test add("1,2") => Ok(3)
; @test add("-1,2,-3") => Err([-1, -3])
```

`./mn test` discovers `*.test.mnd` files and any other `.mnd` file that
carries `@test`, and runs them as one process.

```bash
./mn test
./mn test examples/sc.mnd
./mn test examples/sc.mnd --show-output
```

The standard library's own modules are full of these lines. Reading
[stdlib/list.mnd](../stdlib/list.mnd) is a good way to see the style.

## `mn`

Build the compiler once from a clean checkout (see the [README](../README.md)
for tools), then:

```bash
./mn run examples/loop-sum.mnd
./mn run examples/echo-file.mnd -- a b
./mn examples/sc.mnd a b
./mn build examples/loop-sum.mnd -o out
./mn test
./mn test examples/sc.mnd --show-output
./mn inter examples/sc.mnd --show-result
```

`run` compiles, links, and executes. `build` stops at the binary. `test`
runs the `@test` lines. `inter` is the reference interpreter, useful when
you want the oracle rather than the native binary.

## The compiler

The compiler is a Menard program in `src/`. Two executions of it compile that
same source:

1. The reference interpreter runs `src/mn.mnd` and emits bitcode (`bc0`).
2. That bitcode, linked with the runtime, is a native compiler. It emits
   bitcode for the same source (`bc1`).

`bc0` and `bc1` are byte for byte the same. Linking `bc1` produces a binary
identical to the one linked from `bc0`. `make bootstrap` is that chain, from
source, with no committed compiler binary.

The identical bitcode shows that the two executions agree. It does not, by
itself, show that they are correct: a mistake in the compiler's own logic is
in both. The interpreter is a separate implementation, and the corpus
compares its results with the compiled programs. That is the correctness
check. The specification's [§2.14](menard-spec.md) says this in full.

## Next steps

- Run the programs in [examples/](../examples/). Each one that defines
  `main` prints a result; `sc.mnd` is exercises for `@test`.
- Open [stdlib.md](stdlib.md) for the module you need.
- Open [syntax.md](syntax.md) when a form looks odd.
- Treat [menard-spec.md](menard-spec.md) as the law when a corner case
  matters.
