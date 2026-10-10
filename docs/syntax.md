# Menard — Surface syntax

The syntax of Menard source files (`.mnd`). This document is the input to a
migration of both front ends (the TypeScript interpreter and the Menard
reader), the desugarers, the standard library, the compiler, the examples, and
the `; @test` annotations.

[`menard-spec.md`](menard-spec.md) remains the semantic specification. Where
this document is silent, that specification stands: types are still declared
and never inferred at a polymorphic definition, there are still no macros, no
overloading, no currying, and no implicit conversions. Section
[Lowering](#lowering) is the contract between the new surface and the language
that specification describes.

Two semantic changes are part of this syntax, not just spelling:

- `cond` is the laid-out conditional and `if` is the inline value. Both
  lower to a nested `(if test then else)`. A missing else is legal only
  when every arm has type `Unit`; the missing arm is `Unit`. An `if` or
  `cond` that produces any other type and has no else is a type error.
  The runtime panic `cond: no match` is gone. `when` is only a pattern
  guard.
- Equality is written `==`. The declaration token is `=`.

---

## 1. Lexical syntax

Source is a sequence of bytes. The reader is byte-oriented. `;` starts a
comment that runs to the end of the line. Comments and blank lines are
insignificant, except that a blank line does not end a layout form
([§3](#3-layout)).

### 1.1 Whitespace and indentation

Space (`0x20`), tab (`0x09`), carriage return, and newline are whitespace.
Indentation is the number of leading spaces on a line. A tab in leading
whitespace is a lexical error. A tab elsewhere is ordinary whitespace.

### 1.2 Identifiers

An identifier starts with an ASCII letter. After the first character, the
following may appear with no surrounding whitespace:

| Characters | Where |
|---|---|
| letters and digits | anywhere in the rest |
| `-` `+` `*` `/` `:` `@` | anywhere in the rest |
| `!` | only as the final character |

So `String.concat`, `Buf.append-byte!`, `f+`, `f-`, `f*`, `f/`, `std/list`, and
`github:owner/repo@v1.2.0/console` are each one identifier. `a-b` is one
identifier, not a subtraction. `!` anywhere but the end is a lexical error.

Casing is unchanged and is checked by the parser and the typer, not the
lexer: a type or constructor starts with an uppercase letter; a value,
function, field, or module path starts with a lowercase letter; a type
variable starts with a lowercase letter.

### 1.3 Operators

A binary operator is a token only when whitespace stands on both sides. A
newline counts as that whitespace. Without whitespace on both sides, `==`,
`!=`, `<=`, `>=`, `&&`, `||`, and `->` are lexical errors, and `+ - * / % < >`
are the identifier characters of [§1.2](#12-identifiers) when they occur
inside an identifier.

| Token | Role |
|---|---|
| `=` | declaration and expression-body introducer |
| `==` `!=` | equality, inequality |
| `<` `>` `<=` `>=` | comparison |
| `&&` `\|\|` | short-circuit conjunction, disjunction |
| `+` `-` `*` `/` `%` | `Int` arithmetic |
| `::` | list cons, in expressions and in patterns |
| `->` | return type, arm body, function type |
| `\|` | alternative, at the start of an arm or between or-patterns |
| `\|>` | pipe: append the left-hand value as the last argument of the call on the right |
| `.` | field or export projection, glued to both names |

Unary minus and a negative numeric literal are the exception: `-` immediately
followed by an identifier or a numeric literal, with no space, is prefix
minus or part of the literal (`-x`, `-3`, `-0.5`). `a -b` is a lexical error.
There is no prefix `!` operator. Logical negation is the call `not(b)`.

`::` associates to the right, in the same precedence band as `+` and `-`.
`1 :: 2 :: []` is `1 :: (2 :: [])`. It lowers to `Cons`. `:` is already the
type separator and an identifier character, so cons cannot be a single colon.
`[]`, `[1, 2, 3]`, and `Nil` stay. `Cons(h, t)` remains a legal constructor
call; `::` is the spelling programs use.

`.` is not a whitespace operator. It is glued to the receiver and the name:
`pair.fst`, `Lexer.read(src)`. A call of a projection is still a call. There
is no method call; the function takes the collection as an argument.

`|>` is one operator, and it needs whitespace on both sides, the same way
`||` does. An arm's `|` stays `|`: the following `>` is part of the operator
only when it is the next byte. Desugaring is in [§5.3](#53-operators).

Float arithmetic is not infix. `f+`, `f-`, `f*`, and `f/` are ordinary
identifiers, called as functions: `f+(a, b)`. `+` is `Int` addition only.
There is no overloading.

### 1.4 Literals

| Literal | Spelling |
|---|---|
| `Int` | decimal, optional leading `-` or `+` glued to the digits |
| `Float` | the same, with `.` or an exponent (`e` / `E`, optional sign) |
| `Bool` | `true`, `false` |
| `Str` | `"` … `"`, with the escapes below |
| `Sym` | `'` glued to an identifier (`'red`) |
| `Unit` | `()` |
| list | `[e, …]`, or `[]` |

`Char` has no literal syntax. There is no map literal.

A string literal is the bytes between `"` quotes. These backslash sequences
are decoded; every other byte is copied unchanged, including newline, NUL,
and bytes that are not UTF-8:

| Escape | Bytes |
|---|---|
| `\\` | `0x5C` |
| `\"` | `0x22` |
| `\n` | `0x0A` |
| `\r` | `0x0D` |
| `\t` | `0x09` |
| `\u{` hex `}` | the UTF-8 encoding of one Unicode scalar |

Hex is one to six digits (`0-9`, `a-f`, `A-F`). The scalar is a code point
in `U+0000`–`U+10FFFF` excluding the surrogate range `U+D800`–`U+DFFF`. Any
other `\` sequence is a lexical error (`\q`, `\u`, `\u{}`, a seventh digit,
a surrogate, a value above `U+10FFFF`).

`$` is an ordinary byte. There is no interpolation.

This is Kestrel's string-escape set, kept suitable for a byte string: `\u{…}`
writes UTF-8 rather than a code-point string, and a raw byte stays a raw
byte so a literal can still hold an arbitrary `Str`. `show` does not emit
these escapes. It escapes only `\` and `"` and writes every other byte raw,
which is what stays total on invalid UTF-8.

### 1.5 Keywords

```
alias  cond  else  extern  fn  if  import  let  loop  match
panic  pub  record  recur  ref  deref  return  set!  type  while  when
```

`when` is a pattern guard, not a statement. `else` is a `cond` or `match` arm
test, not a clause terminator. `cond` is four letters so a bar indented two
spaces sits under the word and the guard starts in the column after `cond`.
`as` is not a keyword: it is special only immediately after an import path,
and it can still be a name everywhere else. `defn`, `defrec`, `variant`,
`do`, `and`, and `or` are not keywords.

---

## 2. Programs

A file is a sequence of top-level declarations, each starting at indentation
0. `pub` may prefix `let`, `record`, `type`, and `alias`. It may not prefix
`extern` or `import`.

```
program     = decl*
decl        = import / extern / [pub] (alias / record / type / function)
import      = "import" module-path ["as" Upper]
module-path = identifier / string
extern      = "extern" identifier "(" param,* ")" "->" type
alias       = "alias" Upper "=" type
record      = "record" Upper [tparams] "{" field,* "}"
type        = "type" Upper [tparams] "=" arm-list
function    = "let" lower [tparams] "(" param,* ")" "->" type body
tparams     = "[" lower ("," lower)* "]"
param       = ["..."] lower ":" type
field       = lower ":" type
body        = "=" expr / block
```

`...` is legal only on the last parameter, and that parameter's type must be
a `List`. A lambda cannot take `...`.

Imports in one file sit on consecutive lines. A blank line separates that
block from the next declaration.

```
import std/list
import "./lexer.mnd" as Lexer
import github:owner/repo@v1.2.0/console

extern mn_exists(path: Str) -> Bool

pub alias Ints = List Int
pub alias Pass = (Ast, Env) -> Ast

pub record Counts {
  passed: Int
  failed: Int
}

pub record Pair[a, b] {
  fst: a
  snd: b
}

type Tree[a] =
  | Empty
  | Leaf(a)
  | Node(Tree a, Tree a)

pub let id[a](x: a) -> a =
  x

let sum(...xs: List Int) -> Int =
  fold(add, 0, xs)
```

An alias takes no type parameters. `alias IntTree = Tree Int` is the way to
name an applied type. A record has one constructor, the type's name, and
fields in declaration order. A `type` alternative is a constructor: a bare
name when it has no payload, or `Name(type, …)` when it does. The empty
forward declaration with no constructors is not part of this syntax. The typer
registers every type name before checking payloads, so a type may mention
itself.

### 2.1 Function declarations and function values

A top-level `let` whose name is followed by a parameter list is a known
function. It is recursive, its signature is mandatory, it may be `pub`, and
it may declare type parameters. Calls of it are direct. It lowers to today's
`defn`.

A function value is an expression. It is a closure, including when it
captures nothing. Calls of it are indirect. A parameter's type and the
return type may be omitted, and are then inferred locally. They are present
or absent together: either both are written, or neither is.

```
let adder(n: Int) -> (Int) -> Int =
  fn (m) = n + m

let join-path = fn (dir: Str, name: Str) -> Str =
  cond
    | dir == "" || dir == "." -> name
    | dir == "/" -> String.concat("/", name)
    | else -> String.concat(dir, "/", name)
```

A parameter-list `let` is the same declaration at any indent. Below column 0
it lowers to a `let` of a `fn`. A local function written `let name = fn …`
stays a lambda, including when the parameter types are inferred. A named
local function that captures nothing is lifted to a direct call. A function
that captures a name stays a heap closure. A recursive local name resolves
to that lifted function inside its own body.

---

## 3. Layout

Braces terminate blocks. An arm list is terminated by indentation.

When a binding or test uses a block after `=`, put the opening brace on
the same line as `=`. Indent the block contents two spaces further than
the declaration and align the closing brace with the declaration:

```
test "two numbers" = {
  add("1,2") == Ok(3)
}
```

This is a layout idiom, not a grammar restriction; the reader also accepts
an opening brace on the following line.

The *introducer* of a `cond`, a `match`, or a `type` is the line containing
that keyword, or the `=` of the `type`. Each arm is a line whose first token
is `|`, indented strictly further than its introducer. The list ends at the
first non-blank line whose indentation is less than or equal to the
introducer's. A `|` at the beginning of a line belongs to `cond`, `match`,
or `type`, never to `if`.

`cond` is the laid-out conditional. The keyword is alone on its line. Inside
a function the bars indent two spaces further than `cond`. Four letters is
what makes a two-space bar sit under the word and the guard start in the
column after `cond`.

```
cond
  | n < 0 -> "negative"
  | n == 0 -> "zero"
  | else -> "positive"
```

`if` is the inline expression. The test is parenthesized because there is no
newline to end it. `| expr` is the else: no `else` keyword and no second
`->`. The nearest `if` takes the bar. One line is the idiom, not a grammar
rule.

```
if (n < 0) -> -n | n
```

A value-producing `if` must have the `|` arm, and both arms have the same
type. The arm may be omitted only when it is `Unit` (`if (ready) -> ()`).

Arms of one form do not include a more-indented arm list nested inside an
arm body. A nested `cond` aligns its arms to its own keyword.

A body introduced by `=` may occupy the rest of that line. If it is `if`,
`cond`, or `match`, the arm list that follows belongs to it. A body may
instead be broken across following lines, each indented strictly further
than the `=` line, and those lines end at the same offside column.

A block is `{` expressions `}`. Newlines separate the expressions.
Indentation inside a block does not end the block; the closing `}` does. A
line indented further than the expression it follows continues that
expression. The value of a block is the value of its last expression. A
block contains at least one expression. `()` is the unit value.

```
let line(s: Str) -> Unit {
  write(stdout, s)
  write(stdout, "\n")
  ()
}
```

There is no `;` statement terminator.

---

## 4. Types

A type is a spine or an arrow. An arrow has lower precedence than
application, so `Map Str Int -> Bool` means `(Map Str Int) -> Bool`.

```
type        = arrow
arrow       = "(" type,* ")" "->" type
            / "(" ")" "->" type
            / spine "->" type
            / spine
spine       = atom atom*
atom        = "(" type ")"
            / "(" arrow ")"
            / Upper
            / lower
```

Application is juxtaposition and is not curried: `Tree a`, `List Int`,
`Map Str (List Int)`, `Maybe (Env v)`, `Pair k v`. A spine stops at `,`,
`)`, `}`, `|`, `->`, `=`, or the end of the line. Parentheses group.
`(Int, Str) -> Bool` is a function of two arguments. `() -> Str` is a
function of none. `(Int) -> Str` is a function of one. A function type used
as an argument is parenthesized: `List ((Int) -> Bool)`.

`[a, b]` appears only in a declaration, as the type-parameter list. It is
not type application.

---

## 5. Expressions

```
expr        = cond / if / match / loop / while / lambda / block / return / panic / bin
cond        = "cond" cond-arm+
cond-arm    = "|" test "->" expr
if          = "if" "(" expr ")" "->" expr ["|" expr]
match       = "match" "(" expr ")" arm+
arm         = "|" test "->" expr
test        = "else" / expr
loop        = "loop" "(" binding,* ")" expr
binding     = lower "=" expr
while       = "while" "(" expr ")" block
lambda      = "fn" "(" param,* ")" ["->" type] body
return      = "return" expr
panic       = "panic" "(" expr ")"
block       = "{" expr+ "}"
bin         = unary (operator unary)*
unary       = ["-"] app
app         = postfix "(" expr,* ["..."] ")"
            / postfix
postfix     = atom ("." identifier)*
atom        = literal / identifier / "(" expr ")" / list
list        = "[" expr,* "]"
```

`ref`, `deref`, and `set!` are written as calls: `ref(n)`, `deref(i)`,
`set!(i, deref(i) - 1)`. `set!` 's first argument is a name.

A call's `...` splices a list argument and may appear on any argument.
`sum()` packs an empty list, `sum(1, 2, 3)` packs those elements,
`sum(...xs)` splices `xs`, and `sum(1, ...xs, 1)` puts `1` on either side
of that splice.

`recur(e, …)` appears only in tail position of its `loop` body. `return`
exits the enclosing function. `while` yields `Unit`. `loop` yields the value
of its body.

```
let sum-to(n: Int) -> Int =
  loop (i = 0, acc = 0)
    if (i > n) -> acc | recur(i + 1, acc + i)

let count-down(n: Int) -> Unit {
  let i = ref(n)
  while (deref(i) > 0) {
    print(deref(i))
    set!(i, deref(i) - 1)
  }
}
```

### 5.1 `cond` and `if`

`cond` tries each guard in order. Every guard is a `Bool`, except `else`,
which is the last arm or is absent. The value is the expression of the first
guard that is true. Both forms lower to the nested four-element
`(if test then else)`. A missing else is `()`.

A value-producing `if` has both arms, and they have the same type. An `if`
with no `|` arm has type `Unit`, and its arm must be `Unit`.

```
let sign(n: Int) -> Str =
  cond
    | n < 0 -> "negative"
    | n == 0 -> "zero"
    | else -> "positive"

let abs(n: Int) -> Int =
  if (n < 0) -> -n | n

if (failed > 0) -> print(summary)
```

### 5.2 `match`

The scrutinee is parenthesized. Patterns are tried in order. `match` is
exhaustive. A guard does not count as coverage. The arm expressions have a
common type.

```
let code(color: Color) -> Int =
  match (color)
    | Red | Blue -> 0
    | n when n < 0 -> -1
    | Rgb(r, g, b) -> r

match (m)
  | Some(n) -> {
      print(n)
      0
    }
  | None -> 0
```

An or-pattern's `|` sits on the same line as the arm, after a pattern and
before `->`. A `|` that begins a line begins an arm.

### 5.3 Operators

Precedence, tightest first. Associativity is left.

| Precedence | Operators | Notes |
|---|---|---|
| 6 | prefix `-` | glued to its operand |
| 5 | `*` `/` `%` | `Int` |
| 4 | `+` `-` `::` | `Int` arithmetic; `::` associates to the right |
| 3 | `<` `>` `<=` `>=` | chaining, see below |
| 3 | `==` `!=` | chaining, see below |
| 2 | `&&` | short-circuit |
| 1 | `\|\|` | short-circuit |
| 0 | `\|>` | last-argument insertion; the right-hand side is a call |

`a + b + c` is `(a + b) + c`. `a :: b :: c` is `a :: (b :: c)`. `a < b < c` is `a < b && b < c`, and `b` is
evaluated twice. The same chaining rule applies to `==` and `!=` and to the
relational operators, including mixtures that the existing desugarer already
chains. `!=` is `not` of `==`.

`&&` and `||` are binary and short-circuit. They are today's `and` and `or`.

`|>` associates to the left and binds looser than `||`. The right-hand side
is a call. Desugaring, which runs before typechecking, appends the left-hand
value as that call's last argument:

```
tokens |> List.map(I.parse) |> List.filter(fn (n) = n <= 1000)
```

is `List.filter(fn (n) = n <= 1000, List.map(I.parse, tokens))`. `Err()` and
`List.sort()` are calls with no written arguments, so
`numbers |> List.filter(is-negative) |> Err()` is
`Err(List.filter(is-negative, numbers))`. A bare name, including `List.map`
with no parentheses, is a desugar error (`pipe expects a call`): the
parentheses show which arguments are already filled. `String.drop(n)` is a
call whose callee is a projection, so `s |> String.drop(n)` is
`String.drop(n, s)`.

---

## 6. Patterns

```
pattern     = or-pattern
or-pattern  = app-pattern ("|" app-pattern)*
app-pattern = Upper "(" pattern,* ")"
            / Upper
            / "[" pattern,* "]"
            / literal
            / lower
            / "_"
guarded     = pattern ["when" expr]
```

A constructor pattern uses the same parentheses as a call. A nullary
constructor is a bare name. A record pattern is positional, in field
declaration order: `Counts(p, f)`, `Span(s, _, _, _)`. `_` matches anything
and binds nothing. A lowercase name binds. List patterns are `[h, t]` only
when the list's length is fixed; the open list pattern is `h :: t`, and
`[]` is the empty list. `::` in a pattern associates to the right, the same
way it does in an expression. Literals are `Int`, `Str`, and `Sym`. Patterns nest.
A `when` guard is a `Bool` expression and may use the names the pattern
bound.

---

## 7. Test annotations

`; @module` and `; @test` stay line comments. The text after the tag is
source in this syntax, read by the test runner and the docs tool.

```
; @module std/list
; @test length([1, 2, 3]) => 3
; @test nth([10, 20], 1) => Some(20)
; @test map(fn (n) = n + 1, [1, 2]) => [2, 3]
; @test summary(Counts(1, 0), 1, false)
```

`=>` separates the expression from its expected value and is not an operator
of the language. An annotation with no `=>` expects the expression to
evaluate without a panic.

---

## 8. Lowering

The desugarer produces the current core. The typer, closure conversion, and
the emitter do not grow a second language. Names in the core stay the names
the backend already knows (`defn`, `=`, `and`), including where the surface
word has changed.

| Surface | Core |
|---|---|
| top-level `let f(ps) -> T = e` | `(defn f (ps) -> T e)` |
| top-level `let f(ps) -> T { … }` | `(defn f (ps) -> T (do …))` |
| `let f = fn …` | `(let f (fn …))`, a closure |
| nested `let f(ps) -> T = e` | `(let f (fn (ps) e))` |
| `let x = e` | `(let x e)` |
| `{ e1 e2 e3 }` | `(do e1 e2 e3)` |
| `cond \| p -> a \| else -> b` | `(if p a b)`, nested for further arms |
| `if (p) -> a \| b` | `(if p a b)` |
| `if (p) -> a` | `(if p a ())`, and a type error unless `a` is `Unit` |
| `match (e) \| P -> a` | `(match e (P a) …)` |
| `type Name = …` | `(variant Name …)` |
| `record Name { … }` | `(defrec Name …)` |
| `alias Name = T` | `(alias Name T)` |
| `a + b`, and the other arithmetic operators | the binary intrinsic |
| `a :: b` | `(Cons a b)` |
| `pair.fst` | `(project pair fst)`, then the field's slot |
| `import path as Name` | `(import path Name)`; `Name.f` resolves `f` in that module |
| `a < b < c` | `(and (< a b) (< b c))`, middle evaluated twice |
| `a == b` | `(= a b)` |
| `a != b` | `(not (= a b))` |
| `a && b`, `a \|\| b` | `(and a b)`, `(or a b)` |
| `x \|> f(a)` | `(f a x)` |
| `f(a, b)` | `(f a b)` |
| `Name(a, b)` in expression or pattern position | `(Name a b)` |
| `[a, b]` | `(Cons a (Cons b (Nil)))` |
| `'red` | `(quote red)` |
| `...` on a last parameter or an argument | the existing rest and spread sugar |

A known top-level function is never lowered to `fn`. A nested parameter-list
`let` is a `fn` binding. Closure conversion lifts a named function whose
capture set is empty to a direct call. An anonymous `fn`, and any function
that captures a name, stays a heap closure and an indirect call.

`String.concat(a, b, c)` left-folds once the callee is `std/string`'s `concat`.
One argument is that argument. A bare `concat` from `std/list` is not folded.
`+` `*` `f+` `f*` written as calls left-fold during desugaring, and so do `-`
and `f-`, whose one-argument call form is negation. Infix `-` is always binary;
prefix `-` on a non-literal is the one-argument negation.

---

## 9. Removed forms

| Removed | Write instead |
|---|---|
| `defn` | top-level `let f(…) -> T =` or `let f(…) -> T { }` |
| `defrec` | `record` |
| `variant` | `type Name = \| …` |
| `do` | a block |
| a `when` statement | `if` with no else, body of type `Unit` |
| `and`, `or` | `&&`, `\|\|` |
| a call written as a head followed by its arguments | `f(a, b)` |
| equality written as a call | `a == b` |

The forms in the table above are not accepted as source. There is no reader
mode that parses an older spelling beside this one. The interpreter and the
Menard reader accept and reject the same programs, and they report the same
diagnostic code at the same primary span.

---

## 10. Worked fragment

Today's `join-path` and `summary` from `stdlib/test.mnd`:

```
pub record Counts {
  passed: Int
  failed: Int
}

let join-path(dir: Str, name: Str) -> Str =
  cond
    | dir == "" || dir == "." -> name
    | dir == "/" -> String.concat("/", name)
    | else -> String.concat(dir, "/", name)

pub let summary(c: Counts, ms: Int, on: Bool) -> Unit =
  match (c)
    | Counts(p, f) -> {
        if (f > 0) -> {
          write(stdout, paint(on, "[31m", String.concat(show(f), " failed")))
          write(stdout, ", ")        
        }
        write(stdout, paint(on, "[32m", String.concat(show(p), " passed")))
        write(stdout, String.concat(" (", show(ms), "ms)"))
        write(stdout, "\n")
      }
```
