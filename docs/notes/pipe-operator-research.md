# Function piping in Bendu and Elm

Research note. Each claim is tied to a primary source read on 10 October 2026: the Bendu language definition and compiler in `/Users/graemelockley/Projects/bendu-lang`, the Elm language guide, `elm/core` 1.0.5, and the Elm compiler sources on the `master` branch. This note records what those sources say. It does not propose a design.

Citation form: a claim, then the source that states it.

## Bendu

### The language definition and the parser have no function pipe

The operator productions in the language definition are `||`, `&&`, the relation operators, `>>`, `>!`, `<<`, `<!`, `+`, `-`, `*`, `/`, `%`, and `**`. There is no `|>` production and no section that describes piping a value into a function. ([bendu-lang.md](file:///Users/graemelockley/Projects/bendu-lang/bendu-lang.md), “2.2.5 Operators and Expressions”)

The compiler grammar is the same set. `StarpendOp` is `">>" | ">!" | "<<" | "<!"`. `Factor` and `QualifiedExpressionSuffix` cover calls, array projection (`!`), literals, identifiers, and `fn`. They do not include `|>`. ([Grammar.llgd](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/main/littlelanguages/lang/Grammar.llgd))

The parser visitor lowers `Starpend` with `fold` into `BinaryExpression` nodes whose operators are `GreaterGreater`, `GreaterBang`, `LessLess`, and `LessBang`. Those four names are the whole `Op` enum besides arithmetic, comparison, `&&`, and `||`. ([Parser.kt](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/main/kotlin/io/littlelanguages/bendu/Parser.kt), `visitStarpend` and `visitStarpendOp1`–`visitStarpendOp4`; [AST.kt](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/main/kotlin/io/littlelanguages/bendu/AST.kt), `enum class Op`)

### `>>`, `>!`, `<<`, and `<!` are array prepend and append

`1 >> []` compiles to `ARRAY_PREPEND_ELEMENT_DUPLICATE`. `1 >! []` compiles to `ARRAY_PREPEND_ELEMENT`. `[] << 1` compiles to `ARRAY_APPEND_ELEMENT_DUPLICATE`. `[] <! 1` compiles to `ARRAY_APPEND_ELEMENT`. The duplicate forms leave the original array unchanged; the bang forms write the array in place. ([Compiler.kt](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/main/kotlin/io/littlelanguages/bendu/Compiler.kt), `compileBinaryExpression`; [CompilerTest.kt](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/test/kotlin/io/littlelanguages/bendu/CompilerTest.kt), the four array-operator cases; [docs/array.md](file:///Users/graemelockley/Projects/bendu-lang/docs/array.md), the final repl block under the sentence “Finally, there are a number of operators that simplify the assembling and mutation of arrays.”)

Their types match that split. `<<` and `<!` take `Array[a]` then an element. `>>` and `>!` take an element then `Array[a]`. ([Inference.kt](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/main/kotlin/io/littlelanguages/bendu/Inference.kt), `binaryOperatorSignatures`)

These spellings are the same characters Elm uses for function composition. In Bendu they are array operators. Elm’s composition operators are recorded in the Elm section below.

### Precedence and associativity of those array operators

In the grammar, `Starpend` sits between `Equality` and `Additive`: a relational operator binds looser, and `+` / `-` bind tighter. The visitor builds a chain with `a2.fold(a1)`, so a chain groups to the left. ([Grammar.llgd](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/main/littlelanguages/lang/Grammar.llgd), `Equality` through `Additive`; [Parser.kt](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/main/kotlin/io/littlelanguages/bendu/Parser.kt), `visitStarpend`)

The language definition prints that same grammar and does not add a prose rule for associativity. ([bendu-lang.md](file:///Users/graemelockley/Projects/bendu-lang/bendu-lang.md), “2.2.5 Operators and Expressions”)

### Calls, partial application, and placeholders

Function application is parentheses around a comma-separated argument list: `function(arg1, arg2, ...)`. ([bendu-lang.md](file:///Users/graemelockley/Projects/bendu-lang/bendu-lang.md), “2.3.1 Function Application”)

A call is type-checked as one arrow whose domain is exactly the arguments written at that call. The constraint is `TArr(domain, tv)` with `domain` equal to `expression.arguments`. Supplying fewer arguments is a different function type, not a function of the remaining arguments. ([Inference.kt](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/main/kotlin/io/littlelanguages/bendu/Inference.kt), `ApplyExpression`)

A function of the remaining arguments is written with an explicit `fn`. The function-scenarios note shows `compose(f, g, n)` and then the form it prefers, `let compose(f, g) = fn(n) = f(g(n))`, applied as `compose(double, inc)(2)`. ([docs/function-scenarios.md](file:///Users/graemelockley/Projects/bendu-lang/docs/function-scenarios.md), “Higher order functions” and “Anonymous Functions”)

`_` is a parameter wildcard and a pattern wildcard. It is not an expression form, so it cannot mark a hole inside a call. ([Grammar.llgd](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/main/littlelanguages/lang/Grammar.llgd), `FunctionParameter` and `PatternFactor`; the expression `Factor` alternatives in the same file). The language definition’s shorter `FunctionParameter` production is only `LowerID [TypeQualifier]`. ([bendu-lang.md](file:///Users/graemelockley/Projects/bendu-lang/bendu-lang.md), “2.2.3 Expressions”)

### How the standard library orders parameters

The two modules that exist do not share one order.

`Option` puts the function or the default first and the `Option` last: `map(f, option)`, `withDefault(defaultValue, option)`. The implementation matches: `map*(f, op)`, `map2*(f, op1, op2)` through `map5*`, `andThen*(f, op)`, `withDefault*(a, op)`. ([bendu-lang.md](file:///Users/graemelockley/Projects/bendu-lang/bendu-lang.md), “5.2.1 Option Module”; [lib/Data/Option.bendu](file:///Users/graemelockley/Projects/bendu-lang/lib/Data/Option.bendu); [lib/Data/Option.md](file:///Users/graemelockley/Projects/bendu-lang/lib/Data/Option.md), `map2`)

`String` puts the string first: `length(s)`, `concat(s1, s2)`, `substring(s, start, length)` in the definition, and `length*(s)`, `at*(s, pos)` in the implementation. ([bendu-lang.md](file:///Users/graemelockley/Projects/bendu-lang/bendu-lang.md), “5.2.2 String Module”; [lib/Data/String.bendu](file:///Users/graemelockley/Projects/bendu-lang/lib/Data/String.bendu))

No `map` or `filter` over arrays is defined in `lib/` or in `docs/builtins.json`. The builtins file lists `String.length` and `String.at` only. ([docs/builtins.json](file:///Users/graemelockley/Projects/bendu-lang/docs/builtins.json))

### What the definition says about design

The stated principles are static safety, Hindley-Milner inference, expressiveness, performance, and interoperability. The influences paragraph names Elm for its record system with row polymorphism, and does not mention Elm’s pipe or Elm’s argument order. Evaluation is strict, left to right, arguments before the call. Nothing in those sections discusses piping. ([bendu-lang.md](file:///Users/graemelockley/Projects/bendu-lang/bendu-lang.md), “1.1 Design Principles”, “1.2 Influences and Theoretical Foundations”, “4.2 Evaluation Strategy”)

### Where `|>` shows up anyway

The repository README presents this as Bendu:

```bendu
let primes(n) =
  range(2, n)
    |> filter(prime?)
```

`range` and `filter` are not in the standard-library sources above, and `|>` is not in the grammar. ([README.md](file:///Users/graemelockley/Projects/bendu-lang/README.md), “Examples”)

`docs/index.md-` contains `range(11) |> map(factorial)` inside a fence tagged `rebo-repl`, in the “While Expression” section. ([docs/index.md-](file:///Users/graemelockley/Projects/bendu-lang/docs/index.md-))

The other `|>` occurrences are Rebo programs used to build Bendu: `bin/bendu`, `bin/bendu-test`, `bin/src/test-bendu-markdown.rebo`, `tasks/generate_builtins`, and `tasks/generate_ops`. They refer to `rebo.args`. They are not the Bendu grammar.

## Elm

### `|>` and `<|` are functions, written as infix operators

Every Elm file starts, in effect, with `import Basics exposing (..)`, so both operators are in scope without a local import. ([elm/core README](https://github.com/elm/core/blob/master/README.md), “Default Imports”)

The expression parser has no production for `|>` or `<|`. A following term is gathered as an argument. A following operator symbol closes the current call and appends that operator to a `Binops` chain. Any operator, including the pipes, is that same path. ([compiler/src/Parse/Expression.hs](https://github.com/elm/compiler/blob/master/compiler/src/Parse/Expression.hs), `chompExprEnd` and `toCall`)

Precedence and associativity come from an `infix` declaration, resolved later by name. ([compiler/src/Canonicalize/Expression.hs](https://github.com/elm/compiler/blob/master/compiler/src/Canonicalize/Expression.hs), `canonicalizeBinops`; [compiler/src/AST/Source.hs](https://github.com/elm/compiler/blob/master/compiler/src/AST/Source.hs), `Infix`)

### Definitions

`elm/core` 1.0.5 declares and defines them as:

```elm
infix right 0 (<|) = apL
infix left  0 (|>) = apR

apR : a -> (a -> b) -> b
apR x f =
  f x

apL : (a -> b) -> a -> b
apL f x =
  f x
```

The documentation sentence for `(|>)` is “Saying `x |> f` is exactly the same as `f x`.” The sentence for `(<|)` is “Saying `f <| x` is exactly the same as `f x`.” The left operand of `|>` is the value; the right operand is a one-argument function. The left operand of `<|` is the function; the right operand is the value. ([src/Basics.elm](https://github.com/elm/core/blob/1.0.5/src/Basics.elm), the infix block and the `apR` / `apL` declarations)

The same file’s example rewrites `String.toInt (String.trim input)` as `input |> String.trim |> String.toInt`. The guide repeats that example and calls the operator something that “relies on partial application.” ([src/Basics.elm](https://github.com/elm/core/blob/1.0.5/src/Basics.elm), `apR` docs; [Function Types](https://guide.elm-lang.org/appendix/function_types.html), “Pipelines”)

### Associativity and precedence

`(|>)` is `infix left 0`. `(<|)` is `infix right 0`. The other `Basics` operators run from precedence 2 (`||`) through 9 (`<<`, `>>`). ([src/Basics.elm](https://github.com/elm/core/blob/1.0.5/src/Basics.elm), the infix block)

The canonicalizer treats a higher precedence number as binding tighter. Equal precedence groups to the left when both operators are `Left`, and to the right when both are `Right`. The same precedence with mismatched associativity is an error, reported as mixing the two operators without parentheses. `(|>)` and `(<|)` are that pair: both precedence 0, opposite associativity. ([compiler/src/Canonicalize/Expression.hs](https://github.com/elm/compiler/blob/master/compiler/src/Canonicalize/Expression.hs), `toBinopStep`; [compiler/src/Reporting/Error/Canonicalize.hs](https://github.com/elm/compiler/blob/master/compiler/src/Reporting/Error/Canonicalize.hs), the `Binop` report, “You cannot mix … without parentheses.”)

So `input |> String.trim |> String.toInt` is `(input |> String.trim) |> String.toInt`, and `f <| g <| x` is `f <| (g <| x)`.

### Precedence relative to function application

Function application is juxtaposition, and the parser records it with `toCall` before the operator is pushed onto the `Binops` list. It is not an entry in the 0–9 infix table. A term after a function is an argument even when an operator follows later, so `list |> List.map f` is parsed as `list |> (List.map f)`. ([compiler/src/Parse/Expression.hs](https://github.com/elm/compiler/blob/master/compiler/src/Parse/Expression.hs), `chompExprEnd` and `toCall`)

### Partial application, and no placeholder syntax

The guide’s account of multiple arrows is that `String.repeat : Int -> String -> String` is `Int -> (String -> String)`. `String.repeat 4` has type `String -> String`. The expression grammar’s terms are variables, literals, lists, records, tuples, accessors, and parenthesized expressions. There is no hole token in that grammar. The guide’s alternative to partial application is an explicit lambda, written as `(\str -> String.repeat 2 str)`. ([Function Types](https://guide.elm-lang.org/appendix/function_types.html), “Hidden Parentheses” and “Partial Application”; [compiler/src/Parse/Expression.hs](https://github.com/elm/compiler/blob/master/compiler/src/Parse/Expression.hs), `term`)

Because `|>` only applies a finished one-argument function, an earlier argument is filled by ordinary partial application on the right-hand side, as in `List.map f` or `String.dropLeft n`. There is no syntax that leaves an earlier parameter open and fills a later one.

### The library puts the data argument last, which is what `|>` consumes

The guide states the convention directly: “Elm also uses the convention that the data structure is always the last argument across the ecosystem.” ([Function Types](https://guide.elm-lang.org/appendix/function_types.html), “Partial Application”)

`List` follows it. `map : (a -> b) -> List a -> List b`, `filter : (a -> Bool) -> List a -> List a`, `drop : Int -> List a -> List a`, `take : Int -> List a -> List a`. ([src/List.elm](https://github.com/elm/core/blob/1.0.5/src/List.elm))

`String` follows it. `dropLeft : Int -> String -> String`, `dropRight : Int -> String -> String`, `slice : Int -> Int -> String -> String`, `left : Int -> String -> String`, `repeat : Int -> String -> String`. The string is the last parameter. `length : String -> Int` and `trim : String -> String` take only the string, so the pipe passes that string straight through, which is the shape of the guide’s `input |> String.trim |> String.toInt` example. ([src/String.elm](https://github.com/elm/core/blob/1.0.5/src/String.elm))

`List.foldl` documents the interaction in code. Its type is `(a -> b -> b) -> b -> List a -> b`, and the docs say `foldl step state [1,2,3]` is like:

```elm
state
  |> step 1
  |> step 2
  |> step 3
```

`step` is `(a -> b -> b)`, so `step 1` still expects the accumulator. The pipe supplies that remaining argument. ([src/List.elm](https://github.com/elm/core/blob/1.0.5/src/List.elm), `foldl`)

The stated reason for the pipe is reading order: “left-to-right” in the guide, “pipelined” code in `Basics`. Both texts also say a pipeline of three or four steps is often clearer as a named helper. The `apR` docs suggest rewriting `x |> f` back to `f x` until no pipes remain, as a way to build intuition. ([Function Types](https://guide.elm-lang.org/appendix/function_types.html), “Pipelines”; [src/Basics.elm](https://github.com/elm/core/blob/1.0.5/src/Basics.elm), `apR`)

## What this means for data-first, uncurried, parenthesized calls

These are consequences of the two sources above, for a language whose calls look like `List.map(f, xs)` and `String.drop(s, n)`, that does not curry, and that requires parentheses at the call.

Elm’s pipe does not choose a parameter slot inside a call. `x |> f` is `f x`, and `f` must already have type `a -> b`. The “last argument” effect exists because a multi-argument Elm function is a chain of one-argument functions, and the libraries put the data parameter at the end of that chain. `list |> List.map f` works because parsing and currying make the right-hand side the function `List.map f : List a -> List b`. ([src/Basics.elm](https://github.com/elm/core/blob/1.0.5/src/Basics.elm), `apR`; [Function Types](https://guide.elm-lang.org/appendix/function_types.html), “Partial Application” and “Pipelines”)

A parenthesized call that already contains every argument is a value, not a function of one remaining argument. Under Elm’s definition, `xs |> List.map(f)` would require `List.map(f)` itself to be the function that receives `xs`. Bendu’s checker treats the arguments inside the parentheses as the whole domain, so a one-argument call and a two-argument function are different types. ([Inference.kt](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/main/kotlin/io/littlelanguages/bendu/Inference.kt), `ApplyExpression`)

Data-first order and Elm’s pipe pull in opposite directions. `String.dropLeft` is `Int -> String -> String`, so the pipe-shaped call is `string |> String.dropLeft n`, which is `String.dropLeft n string`. A data-first `String.drop(s, n)` has the string in the slot Elm leaves open, and the count in the slot Elm expects to be filled before the pipe. The same split appears in list functions: Elm’s `List.map f xs` versus a subject-first `List.map(f, xs)` only lines up if `f` is first; it does not line up with `List.map(xs, f)`. ([src/String.elm](https://github.com/elm/core/blob/1.0.5/src/String.elm), `dropLeft`; [src/List.elm](https://github.com/elm/core/blob/1.0.5/src/List.elm), `map`)

Bendu already shows both orders, with no pipe in the grammar. `Option.map(f, option)` has the `Option` last, which is the Elm slot. `String.at(s, pos)` and `substring(s, start, length)` have the string first. ([bendu-lang.md](file:///Users/graemelockley/Projects/bendu-lang/bendu-lang.md), “5.2.1 Option Module” and “5.2.2 String Module”)

The Bendu README’s `range(2, n) |> filter(prime?)` is the surface of “a call that is still missing the piped value.” Neither the Bendu grammar nor the Elm operators define that. Elm would need `filter(prime?)` to evaluate to a one-argument function. Bendu’s documented way to get that function is an explicit `fn`, as in `compose(f, g)` returning `fn(n) = f(g(n))`. ([README.md](file:///Users/graemelockley/Projects/bendu-lang/README.md), “Examples”; [docs/function-scenarios.md](file:///Users/graemelockley/Projects/bendu-lang/docs/function-scenarios.md), “Anonymous Functions”)

Elm also has no placeholder that would let a data-first call mark the subject slot, such as a hole in `String.drop(_, n)`. The Bendu expression grammar likewise has no hole; `_` is a parameter or a pattern. ([compiler/src/Parse/Expression.hs](https://github.com/elm/compiler/blob/master/compiler/src/Parse/Expression.hs), `term`; [Grammar.llgd](file:///Users/graemelockley/Projects/bendu-lang/components/compiler-kotlin/app/src/main/littlelanguages/lang/Grammar.llgd), `Factor` and `FunctionParameter`)
