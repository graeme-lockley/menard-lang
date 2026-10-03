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

- `cond` and `when` are removed. `if` is the only conditional. A missing
  `else` is legal only when every arm has type `Unit`; the missing arm is
  `Unit`. An `if` that produces any other type and has no `else` is a type
  error. The runtime panic `cond: no match` is gone.
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

So `str-concat`, `sb-append-byte!`, `f+`, `f-`, `f*`, `f/`, `std/list`, and
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
| `->` | return type, `if` / `match` arm, function type |
| `\|` | alternative, at the start of an arm or between or-patterns |

Unary minus and a negative numeric literal are the exception: `-` immediately
followed by an identifier or a numeric literal, with no space, is prefix
minus or part of the literal (`-x`, `-3`, `-0.5`). `a -b` is a lexical error.
There is no prefix `!` operator. Logical negation is the call `not(b)`.

Float arithmetic is not infix. `f+`, `f-`, `f*`, and `f/` are ordinary
identifiers, called as functions: `f+(a, b)`. `+` is `Int` addition only.
There is no overloading.

### 1.4 Literals

| Literal | Spelling |
|---|---|
| `Int` | decimal, optional leading `-` or `+` glued to the digits |
| `Float` | the same, with `.` or an exponent (`e` / `E`, optional sign) |
| `Bool` | `true`, `false` |
| `Str` | `"` … `"`, with `\` and `"` backslash-escaped and nothing else escaped |
| `Sym` | `'` glued to an identifier (`'red`) |
| `Unit` | `()` |
| list | `[e, …]`, or `[]` |

`Char` has no literal syntax. There is no map literal.

### 1.5 Keywords

```
alias  else  extern  fn  if  import  let  loop  match
panic  pub  record  recur  ref  deref  return  set!  type  while  when
```

`when` is a pattern guard, not a statement. `else` is an `if` arm test, not a
clause terminator. `cond`, `defn`, `defrec`, `variant`, `do`, `and`, and `or`
are not keywords.

---

## 2. Programs

A file is a sequence of top-level declarations, each starting at indentation
0. `pub` may prefix `let`, `record`, `type`, and `alias`. It may not prefix
`extern` or `import`.

```
program     = decl*
decl        = import / extern / [pub] (alias / record / type / function)
import      = "import" module-path
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

```
import std/list
import "./lexer.mnd"
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
  if dir == "" || dir == "." -> name
   | dir == "/" -> str-concat("/", name)
   | else -> str-concat(dir, "/", name)
```

Inside a block, `let` binds a value, not a known function. A local function
is `let name = fn …`. A parameter-list `let` at indentation greater than 0
is a parse error.

---

## 3. Layout

Braces terminate blocks. An arm list is terminated by indentation.

The *introducer* of a `match` or a `type` is the line containing `match`, or
the `=` of the `type`. Each arm is a line whose first token is `|`, indented
strictly further than its introducer. The list ends at the first non-blank
line whose indentation is less than or equal to the introducer's.

An `if` puts its first arm on the introducer line, with no `|`:

```
if test -> expr
```

A further arm is a line whose first token is `|`, indented exactly one
column further than that `if`. The word `if` and the space after it are
three columns, and so are that one column, the `|`, and the space after the
bar, so each later test starts in the same column as the first. A `|` at any
other column does not belong to that `if`. The `if` ends at the first
non-blank line that is not such an arm and whose indentation is less than or
equal to the `if`.

Arms of one form do not include a more-indented arm list nested inside an
arm body. A nested `if` aligns its arms to its own keyword.

A body introduced by `=` may occupy the rest of that line. If it is `if` or
`match`, the arm list that follows belongs to it. A body may instead be
broken across following lines, each indented strictly further than the `=`
line, and those lines end at the same offside column.

A block is `{` expressions `}`. Newlines separate the expressions.
Indentation inside a block does not end the block; the closing `}` does. A
line indented further than the expression it follows continues that
expression. The value of a block is the value of its last expression. A
block contains at least one expression. `()` is the unit value.

```
let nl() -> Str {
  let sb = sb-new()
  sb-append-byte!(sb, 10)
  sb-take-str!(sb)
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
expr        = if / match / loop / while / lambda / block / return / panic / bin
if          = "if" test "->" expr arm*
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
app         = atom "(" expr,* ["..."] ")"
            / atom
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
    if i > n -> acc
     | else -> recur(i + 1, acc + i)

let count-down(n: Int) -> Unit {
  let i = ref(n)
  while (deref(i) > 0) {
    print(deref(i))
    set!(i, deref(i) - 1)
  }
}
```

### 5.1 `if`

Every arm's test is a `Bool`, except `else`. `else` is the last arm or it is
absent. Tests are tried in order. The value is the expression of the first
test that is true.

When `else` is absent, every arm's expression must have type `Unit`, and the
`if` has type `Unit`. When `else` is present, every arm's expression has the
same type, and that is the type of the `if`.

The first arm has no bar. Each later bar is one column past `if`, which
puts every test in the column where the first test begins.

```
let sign(n: Int) -> Str =
  if n < 0 -> "negative"
   | n == 0 -> "zero"
   | else -> "positive"

if failed > 0 -> print(summary)
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
| 4 | `+` `-` | `Int` |
| 3 | `<` `>` `<=` `>=` | chaining, see below |
| 3 | `==` `!=` | chaining, see below |
| 2 | `&&` | short-circuit |
| 1 | `\|\|` | short-circuit |

`a + b + c` is `(a + b) + c`. `a < b < c` is `a < b && b < c`, and `b` is
evaluated twice. The same chaining rule applies to `==` and `!=` and to the
relational operators, including mixtures that the existing desugarer already
chains. `!=` is `not` of `==`.

`&&` and `||` are binary and short-circuit. They are today's `and` and `or`.

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
when the list's length is fixed; the open list pattern is `Cons(h, t)`, and
`[]` is the empty list. Literals are `Int`, `Str`, and `Sym`. Patterns nest.
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
| `let x = e` | `(let x e)` |
| `{ e1 e2 e3 }` | `(do e1 e2 e3)` |
| `if \| p -> a \| else -> b` | `(if p a b)`, nested for further arms |
| `if` with no `else` | `(if p a ())`, and a type error unless `a` is `Unit` |
| `match (e) \| P -> a` | `(match e (P a) …)` |
| `type Name = …` | `(variant Name …)` |
| `record Name { … }` | `(defrec Name …)` |
| `alias Name = T` | `(alias Name T)` |
| `a + b`, and the other arithmetic operators | the binary intrinsic |
| `a < b < c` | `(and (< a b) (< b c))`, middle evaluated twice |
| `a == b` | `(= a b)` |
| `a != b` | `(not (= a b))` |
| `a && b`, `a \|\| b` | `(and a b)`, `(or a b)` |
| `f(a, b)` | `(f a b)` |
| `Name(a, b)` in expression or pattern position | `(Name a b)` |
| `[a, b]` | `(Cons a (Cons b (Nil)))` |
| `'red` | `(quote red)` |
| `...` on a last parameter or an argument | the existing rest and spread sugar |

A known function is never lowered to `fn`. A `fn` is never lowered to a
known function, even when its capture set is empty. Closure conversion
therefore keeps today's shape for the `fn` form: a heap closure and an
indirect call.

`str-concat(a, b, c)` keeps the current left fold. One argument is that
argument. The same fold applies to `+` `*` `f+` `f*` written as calls, and
to `-` and `f-`, whose one-argument call form is negation. Infix `-` is
always binary; prefix `-` on a non-literal is the one-argument negation.

---

## 9. Removed forms

| Removed | Write instead |
|---|---|
| `defn` | top-level `let f(…) -> T =` or `let f(…) -> T { }` |
| `defrec` | `record` |
| `variant` | `type Name = \| …` |
| `do` | a block |
| `cond` | `if` |
| `when` | `if` with no `else`, body of type `Unit` |
| `and`, `or` | `&&`, `\|\|` |
| a call written as a head followed by its arguments | `f(a, b)` |
| equality written as a call | `a == b` |

The forms in the table above are not accepted as source. There is no reader
mode that parses an older spelling beside this one. The interpreter and the
Menard reader accept and reject the same programs, and they report the same
diagnostic code at the same primary span.

---

## 10. Worked fragment

Today's `join-path`, `nl`, and `summary` from `stdlib/test.mnd`:

```
pub record Counts {
  passed: Int
  failed: Int
}

let join-path(dir: Str, name: Str) -> Str =
  if dir == "" || dir == "." -> name
   | dir == "/" -> str-concat("/", name)
   | else -> str-concat(dir, "/", name)

let nl() -> Str {
  let sb = sb-new()
  sb-append-byte!(sb, 10)
  sb-take-str!(sb)
}

pub let summary(c: Counts, ms: Int, on: Bool) -> Unit =
  match (c)
    | Counts(p, f) -> {
        if f > 0 -> {
          write(stdout, paint(on, "[31m", str-concat(show(f), " failed")))
          write(stdout, ", ")        
        }
        write(stdout, paint(on, "[32m", str-concat(show(p), " passed")))
        write(stdout, str-concat(" (", show(ms), "ms)"))
        write(stdout, nl())
      }
```
