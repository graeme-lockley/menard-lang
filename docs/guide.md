# Menard

This is the language. The rules, with their edge cases, are in [menard-spec.md](menard-spec.md). The syntax in full is in [syntax.md](syntax.md). The library, function by function, is in [stdlib.md](stdlib.md).

## A program

`add` sums the numbers in a string. Commas and newlines separate them. A number above 1000 is left out. A negative is not summed: the error is every negative, in the order they appeared.

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

`|>` passes the value on the left as the last argument of the call on the right. `tokens |> List.map(Int.parse)` is `List.map(Int.parse, tokens)`. The parentheses show the arguments that are already filled.

A line that starts with `; @test` is a test. `./mn test examples/sc.mnd` runs the ones in the full calculator.

## Values and functions

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

`fn` is a function with no name. It is a value, and it can close over the names around it.

```
let add-to(n: Int) -> (Int) -> Int =
  fn (m) = n + m
```

Values are immutable, except a `Ref` cell and a `StringBuffer`. Those two are shared, and changing one name is visible through the other. Everything else, including `Map`, is a value: updating it gives you a new one.

`Int` is one integer type. `Str` is a sequence of bytes, not necessarily text. `Char` is one Unicode scalar, written `'A'` or `'\n'`. `Float` is a boxed floating-point number.

## Pipes and `?`

The value you have in hand is the last parameter. That is why `List.map` takes the function first and the list last, and why `String.drop` takes the count first and the string last.

```
let positive(xs: List Int) -> List Int =
  xs |> List.filter(fn (n) = n > 0) |> List.map(fn (n) = n * 2)
```

A bare name is not a pipe target. `xs |> List.map` is an error. Write `xs |> List.map(f)`.

`?` unwraps a `Maybe`. The right-hand side runs only when the value is `None`.

```
let first-or-zero(xs: List Int) -> Int =
  xs |> List.head() ? 0
```

`?` binds looser than `|>`, so the pipe's result is what gets unwrapped. A `Result` becomes a `Maybe` first:

```
Result.to-maybe(parsed) ? 0
```

## `cond`, `if`, `match`, and `loop`

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

An `if` or `cond` with no else has type `Unit`. Anything else needs the else arm.

`match` takes the value apart. The arms cover every constructor. A guard (`when`) does not count as coverage.

```
let from-maybe[a, e](err: e, m: Maybe a) -> Result a e =
  match (m)
    | Some(v) -> Ok(v)
    | None -> Err(err)
```

`loop` names the values that change, and `recur` starts the body again with new ones.

```
let sum(xs: List Int) -> Int =
  loop (rest = xs, acc = 0)
    match (rest)
      | [] -> acc
      | n :: tail -> recur(tail, acc + n)
```

## Types

A record is a product. The name is the constructor, and the fields are selected with `.`.

```
pub record Pair[a, b] {
  fst: a
  snd: b
}

let p = Pair(1, "a")
p.fst
```

A variant is a sum. Each alternative is a constructor.

```
type Color =
  | Red
  | Rgb(r: Int, g: Int, b: Int)
```

`Maybe` and `Result` and `List` are variants the language already knows:

```
type Maybe[a] =
  | None
  | Some(a)

type Result[t, e] =
  | Ok(t)
  | Err(e)
```

`[]` is the empty list. `1 :: xs` is cons. `[1, 2, 3]` is that written out.

A polymorphic function declares its type parameters in brackets. The call site does not. The checker fills them in from the arguments.

```
pub let map[a, b](f: (a) -> b, xs: List a) -> List b =
  match (xs)
    | [] -> []
    | h :: t -> f(h) :: map(f, t)
```

An alias is a name for a type, with no parameters of its own: `alias Age = Int`. It disappears before anything is emitted, and diagnostics still show the name you wrote.

## Lists, maps, strings, characters

`std/list` is the collection you reach for first. `map`, `filter`, `fold`, `member`, `sum`, `head`, and `tail` all take the list last.

```
xs |> List.filter(fn (n) = n > 0) |> List.sum()
xs |> List.head() ? 0
xs |> List.append([4, 5])
```

`List.append(extra, xs)` is `xs` followed by `extra`. The pipe reads left to right: start with `xs`, then append these.

`std/map` is a persistent map. Keys are ordered, and iteration follows that order, so two runs print the same keys. Updating a map returns a new map.

```
let ages = Map.empty() |> Map.set("ada", 36) |> Map.set("bea", 41)
ages |> Map.lookup("ada") ? 0
ages |> Map.merge(Map.singleton("ada", 37))
```

`Map.merge(overlay, base)` keeps `overlay` where the keys overlap. A map literal is the same idea written in place. Later entries win.

```
let ages = { "ada" => 36, "bea" => 41 }
```

`std/string` works on bytes. The string is last.

```
s |> String.drop(2) |> String.trim()
s |> String.contains("ell")
String.words("a  b\nc")
```

`Int.parse` reads the leading digits and returns `0` when there are none. `Int.from-str` succeeds only when the whole string is an integer, and it returns a `Maybe`.

`std/char` is ASCII case and a few predicates, written with character literals: `Char.is-digit('5')`, `Char.to-upper('q')`.

`StringBuffer` is the other mutable type. The buffer comes first, because it is the cell you are changing, not a value you pipe.

```
let sb = Buf.new()
Buf.append!(sb, "hello")
Buf.take-str!(sb)
```

The functions are listed in [stdlib.md](stdlib.md).

## Modules

One file is one module. `pub` publishes a name. A name without `pub` stays in the file.

```
import std/list as List
import "./lexer.mnd" as Lexer
```

`List.map` and `Lexer.read` are the exports, not methods. A bare `import std/list` brings the names in directly. Two modules can both publish `map`; import one of them qualified and they stay distinct.

`std/basics` (`id`, `always`, `not`, `min`, `max`, `abs`, `clamp`) is already in scope.

Imports do not cycle.

## `mn`

```bash
./mn run examples/sc.mnd
./mn run examples/echo-file.mnd -- a b
./mn build examples/loop-sum.mnd -o out
./mn test
./mn test examples/sc.mnd --show-output
./mn inter examples/sc.mnd --show-result
```

`run` compiles, links, and executes. `build` stops at the binary. `test` discovers `*.test.mnd` files and any other `.mnd` file that carries `@test`, and runs them as one process. `inter` is the reference interpreter, which is useful when you want the oracle rather than the native binary.

Arguments after `--` are the program's arguments. `exit` sets the status. A panic prints to standard error and exits `1`.

## The compiler

The compiler is a Menard program in `src/`. Two executions of it compile that same source:

1. The reference interpreter runs `src/mn.mnd` and emits bitcode (`bc0`).
2. That bitcode, linked with the runtime, is a native compiler. It emits bitcode for the same source (`bc1`).

`bc0` and `bc1` are byte for byte the same. Linking `bc1` produces a binary identical to the one linked from `bc0`. `make bootstrap` is that chain, from source, with no committed compiler binary.

The identical bitcode shows that the two executions agree. It does not, by itself, show that they are correct: a mistake in the compiler's own logic is in both. The interpreter is a separate implementation, and the corpus compares its results with the compiled programs. That is the correctness check. The specification's [§2.14](menard-spec.md) says this in full.
