# Error codes

Catalogue of every emitted `E_*` / `W_*` diagnostic code. Schema details:
[diagnostics.md](diagnostics.md). Sample objects use schema version 1. For
surface-reachable examples, the sample matches `diagnose` / `mn check --json`
(or module diagnose with stable virtual paths). Codes that only fire on core
list forms document the desugarer/typer emit payload; `E_TEST` is emitted by
`mn test`, not `mn check`. Codes reserved by scope but not yet emitted are
listed under [Reserved](#reserved).

## Stability

Diagnostic codes are stable within an edition. A code is deprecated, not reused:
new meanings get new codes rather than recycling an old id.

## Parse

The reader and casing pass emit these codes before any desugaring. Spans point at the offending token or delimiter.

### `E_PARSE`

- **Severity:** error
- **Meaning:** The reader hit an unexpected character or token.
- **Example:**
```menard
a==b
```
- **Fix:** Insert the missing spaces or correct the token.
- **Help:** "check the syntax near this character"
- **Help:** "did you mean a == b?"
- **Spec:** [syntax.md §1](syntax.md#1-lexical-syntax)

```json
{
  "code": "E_PARSE",
  "severity": "error",
  "message": "unexpected character",
  "help": "did you mean a == b?",
  "path": "a.mnd",
  "span": {
    "start": 1,
    "end": 2,
    "line": 1,
    "column": 2
  }
}
```

Glued `a==b` / `a!=b` keep this code; `help` is the spaced form when both sides are recoverable. Other unexpected characters use the generic help.

### `E_PARSE_UNCLOSED`

- **Severity:** error
- **Meaning:** A delimiter was opened and never closed.
- **Example:**
```menard
(1 + 2
```
- **Fix:** Add the matching closing delimiter.
- **Help:** "close the opening delimiter"
- **Spec:** [syntax.md §1](syntax.md#1-lexical-syntax)

```json
{
  "code": "E_PARSE_UNCLOSED",
  "severity": "error",
  "message": "unclosed (",
  "help": "close the opening delimiter",
  "path": "a.mnd",
  "span": {
    "start": 7,
    "end": 7,
    "line": 2,
    "column": 1
  }
}
```

### `E_PARSE_BANG`

- **Severity:** error
- **Meaning:** `!` appeared somewhere other than the end of an identifier.
- **Example:**
```menard
foo!bar
```
- **Fix:** Use `!` only as a trailing mutation marker on a name.
- **Help:** "'!' may appear only as the final character of an identifier"
- **Spec:** [syntax.md §1](syntax.md#1-lexical-syntax)

```json
{
  "code": "E_PARSE_BANG",
  "severity": "error",
  "message": "'!' may appear only as the final character of an identifier",
  "help": "'!' may appear only as the final character of an identifier",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 5,
    "line": 1,
    "column": 1
  }
}
```

### `E_PARSE_STRING`

- **Severity:** error
- **Meaning:** A string literal was not terminated.
- **Example:**
```menard
"hello
```
- **Fix:** Close the string with a matching quote.
- **Help:** "close the string with a matching quote"
- **Spec:** [syntax.md §1](syntax.md#1-lexical-syntax)

```json
{
  "code": "E_PARSE_STRING",
  "severity": "error",
  "message": "unterminated string",
  "help": "close the string with a matching quote",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 7,
    "line": 1,
    "column": 1
  }
}
```

### `E_CASING`

- **Severity:** error
- **Meaning:** A variant type or constructor name does not begin with an uppercase letter.
- **Example:**
```menard
type color =
  | Red
```
- **Fix:** Rename the constructor to start with an uppercase letter.
- **Help:** "rename the constructor so it starts with an uppercase letter"
- **Spec:** [syntax.md §4](syntax.md#4-types)

```json
{
  "code": "E_CASING",
  "severity": "error",
  "message": "variant type name must begin with an uppercase letter",
  "help": "rename the constructor so it starts with an uppercase letter",
  "path": "a.mnd",
  "span": {
    "start": 5,
    "end": 10,
    "line": 1,
    "column": 6
  }
}
```

## Desugar

Surface sugar lowers to core forms here. Rest/spread checks share this phase even though their codes are `E_TYPE_*`.

### `E_DESUGAR_ARITY`

- **Severity:** error
- **Meaning:** A surface operator was given the wrong number of arguments (message names the operator).
- **Example:**
```menard
f/(1.0)
```
- **Fix:** Pass the arguments the operator requires.
- **Help:** "give the operator the arguments it expects"
- **Spec:** [syntax.md §8](syntax.md#8-lowering)

```json
{
  "code": "E_DESUGAR_ARITY",
  "severity": "error",
  "message": "f/ expects at least 2 arguments",
  "help": "give the operator the arguments it expects",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 7,
    "line": 1,
    "column": 1
  }
}
```

### `E_DESUGAR_COND_CLAUSE`

- **Severity:** error
- **Meaning:** A core `cond` clause is not a list `(test exprs...)`.
- **Example:**
```menard
cond
| true
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload.
- **Fix:** Write each clause as `guard -> body`.
- **Help:** "write each cond clause as a guard/body pair"
- **Spec:** [syntax.md §5](syntax.md#5-expressions)

```json
{
  "code": "E_DESUGAR_COND_CLAUSE",
  "severity": "error",
  "message": "cond clause must be a list (test exprs...)",
  "help": "write each cond clause as a guard/body pair",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 4,
    "line": 1,
    "column": 1
  }
}
```

### `E_DESUGAR_COND_ELSE`

- **Severity:** error
- **Meaning:** `else` appeared before the last `cond` clause.
- **Example:**
```menard
cond
| else -> 0
| true -> 1
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload.
- **Fix:** Move `else` to the final clause.
- **Help:** "move else to the last cond clause"
- **Spec:** [syntax.md §5](syntax.md#5-expressions)

```json
{
  "code": "E_DESUGAR_COND_ELSE",
  "severity": "error",
  "message": "else must be the last cond clause",
  "help": "move else to the last cond clause",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 4,
    "line": 1,
    "column": 1
  }
}
```

### `E_DESUGAR_COND_EMPTY`

- **Severity:** error
- **Meaning:** `cond` has no clauses.
- **Example:**
```menard
cond
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload.
- **Fix:** Add at least one clause.
- **Help:** "add at least one cond clause"
- **Spec:** [syntax.md §5](syntax.md#5-expressions)

```json
{
  "code": "E_DESUGAR_COND_EMPTY",
  "severity": "error",
  "message": "cond requires at least one clause",
  "help": "add at least one cond clause",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 4,
    "line": 1,
    "column": 1
  }
}
```

### `E_DESUGAR_MAP`

- **Severity:** error
- **Meaning:** A map-lit entry is neither a `=>` pair nor a spread.
- **Example:**
```menard
{ 1 }
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload. On the surface `{ 1 }` is a block; the map desugarer emits this for a non-pair entry.
- **Fix:** Write entries as `key => value`.
- **Help:** "write the map as { key => value, ... }"
- **Spec:** [syntax.md §5](syntax.md#5-expressions)

```json
{
  "code": "E_DESUGAR_MAP",
  "severity": "error",
  "message": "map entry must be a pair or a spread",
  "help": "write the map as { key => value, ... }",
  "path": "a.mnd",
  "span": {
    "start": 2,
    "end": 3,
    "line": 1,
    "column": 3
  }
}
```

### `E_DESUGAR_MATCH`

- **Severity:** error
- **Meaning:** A core `mmatch` form is missing scrutinees or arm patterns.
- **Example:**
```menard
match
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload.
- **Fix:** Provide a scrutinee and pattern arms.
- **Help:** "write match with a scrutinee and | pattern -> body arms"
- **Spec:** [syntax.md §5](syntax.md#5-expressions)

```json
{
  "code": "E_DESUGAR_MATCH",
  "severity": "error",
  "message": "match requires scrutinees",
  "help": "write match with a scrutinee and | pattern -> body arms",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 4,
    "line": 1,
    "column": 1
  }
}
```

### `E_DESUGAR_PIPE`

- **Severity:** error
- **Meaning:** The right-hand side of `|>` is not a call.
- **Example:**
```menard
1 |> 2
```
- **Fix:** Write a call on the right of `|>`.
- **Help:** "pipe requires a call on the right; write value |> f(args)"
- **Spec:** [syntax.md §8](syntax.md#8-lowering)

```json
{
  "code": "E_DESUGAR_PIPE",
  "severity": "error",
  "message": "pipe expects a call",
  "help": "pipe requires a call on the right; write value |> f(args)",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 6,
    "line": 1,
    "column": 1
  }
}
```

### `E_DESUGAR_WHEN`

- **Severity:** error
- **Meaning:** A core `when` form is missing its test.
- **Example:**
```menard
when
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload.
- **Fix:** Write `when (cond) body`.
- **Help:** "write when as when (cond) body"
- **Spec:** [syntax.md §8](syntax.md#8-lowering)

```json
{
  "code": "E_DESUGAR_WHEN",
  "severity": "error",
  "message": "when requires a test and optional body",
  "help": "write when as when (cond) body",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 4,
    "line": 1,
    "column": 1
  }
}
```

### `E_DESUGAR_WHILE`

- **Severity:** error
- **Meaning:** A core `while` form is missing its test.
- **Example:**
```menard
while
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload.
- **Fix:** Write `while (cond) body`.
- **Help:** "write while as while (cond) body"
- **Spec:** [syntax.md §8](syntax.md#8-lowering)

```json
{
  "code": "E_DESUGAR_WHILE",
  "severity": "error",
  "message": "while requires a test",
  "help": "write while as while (cond) body",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 4,
    "line": 1,
    "column": 1
  }
}
```

### `E_TYPE_REST`

- **Severity:** error
- **Meaning:** A rest parameter is misplaced or mistyped.
- **Example:**
```menard
let f(xs: Int ...) -> Int = 0
```
- **Fix:** Type the rest parameter as `(List T)` and keep `...` last.
- **Help:** "put ... only on the last parameter, typed as (List T)"
- **Spec:** [syntax.md §5](syntax.md#5-expressions)

```json
{
  "code": "E_TYPE_REST",
  "severity": "error",
  "message": "rest marker must be the last element of the parameter",
  "help": "put ... only on the last parameter, typed as (List T)",
  "path": "a.mnd",
  "span": {
    "start": 14,
    "end": 17,
    "line": 1,
    "column": 15
  }
}
```

### `E_TYPE_SPREAD`

- **Severity:** error
- **Meaning:** A `...` spread appears where a rest call does not allow it.
- **Example:**
```menard
f(...1)
```
- **Fix:** Spread only as the last argument of a rest-parameter function.
- **Help:** "use ... only as the last argument of a rest-parameter call"
- **Spec:** [syntax.md §5](syntax.md#5-expressions)

```json
{
  "code": "E_TYPE_SPREAD",
  "severity": "error",
  "message": "spread is only valid in a rest-parameter call",
  "help": "use ... only as the last argument of a rest-parameter call",
  "path": "a.mnd",
  "span": {
    "start": 5,
    "end": 6,
    "line": 1,
    "column": 6
  }
}
```

## Type

The typer, module graph, and test runner emit these codes. Import and extern checks run with typing of a program graph.

### `E_TYPE_ARITY`

- **Severity:** error
- **Meaning:** A call or pattern has the wrong number of arguments.
- **Example:**
```menard
let f(x: Int, y: Int) -> Int =
  x + y
f(1)
```
- **Fix:** Pass the expected number of arguments.
- **Help:** "check the call: expected and found argument counts must match"
- **Spec:** [menard-spec.md §2.3](menard-spec.md#23-types)

```json
{
  "code": "E_TYPE_ARITY",
  "severity": "error",
  "message": "function arity mismatch: expected 2, found 1",
  "help": "check the call: expected and found argument counts must match",
  "path": "a.mnd",
  "span": {
    "start": 39,
    "end": 43,
    "line": 3,
    "column": 1
  }
}
```

### `E_TYPE_DEFN`

- **Severity:** error
- **Meaning:** A function definition is missing required pieces.
- **Example:**
```menard
let f
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload.
- **Fix:** Add `-> Ret` before the body.
- **Help:** "write defn as name(params) -> Ret = body"
- **Spec:** [syntax.md §2](syntax.md#2-programs)

```json
{
  "code": "E_TYPE_DEFN",
  "severity": "error",
  "message": "malformed defn",
  "help": "write defn as name(params) -> Ret = body",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 4,
    "line": 1,
    "column": 1
  }
}
```

### `E_TYPE_DUPLICATE`

- **Severity:** error
- **Meaning:** The same type name is defined twice in one scope.
- **Example:**
```menard
type Color =
  | Red
type Color =
  | Blue
```
- **Fix:** Rename or remove one definition.
- **Help:** "rename or remove the duplicate definition"
- **Spec:** [menard-spec.md §2.3](menard-spec.md#23-types)

```json
{
  "code": "E_TYPE_DUPLICATE",
  "severity": "error",
  "message": "type Color is already defined",
  "help": "rename or remove the duplicate definition",
  "path": "a.mnd",
  "span": {
    "start": 21,
    "end": 42,
    "line": 3,
    "column": 1
  }
}
```

### `E_TYPE_EXHAUSTIVE`

- **Severity:** error
- **Meaning:** A `match` does not cover every constructor.
- **Example:**
```menard
type Color =
  | Red
  | Blue
let f(c: Color) -> Int =
  match (c)
    | Red -> 1
```
- **Fix:** Cover every constructor or add `_`.
- **Help:** "cover every constructor, or add a wildcard arm"
- **Spec:** [menard-spec.md §2.4](menard-spec.md#24-control-flow)

```json
{
  "code": "E_TYPE_EXHAUSTIVE",
  "severity": "error",
  "message": "non-exhaustive match: missing Blue",
  "help": "cover every constructor, or add a wildcard arm",
  "path": "a.mnd",
  "span": {
    "start": 57,
    "end": 81,
    "line": 5,
    "column": 3
  }
}
```

### `E_TYPE_EXPR`

- **Severity:** error
- **Meaning:** A type expression is not well formed.
- **Example:**
```menard
let f(x: 1) -> Int = 0
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload.
- **Fix:** Rewrite the type expression.
- **Help:** "fix the type expression"
- **Spec:** [syntax.md §4](syntax.md#4-types)

```json
{
  "code": "E_TYPE_EXPR",
  "severity": "error",
  "message": "invalid type expression",
  "help": "fix the type expression",
  "path": "a.mnd",
  "span": {
    "start": 10,
    "end": 11,
    "line": 1,
    "column": 11
  }
}
```

### `E_TYPE_FN`

- **Severity:** error
- **Meaning:** A function type is missing `->` or a return type.
- **Example:**
```menard
let f(g: (Fn Int Int)) -> Int = 0
```
- **Fix:** Write `Fn(Args) -> Ret`.
- **Help:** "write the function type as Fn(Args) -> Ret"
- **Spec:** [syntax.md §4](syntax.md#4-types)

```json
{
  "code": "E_TYPE_FN",
  "severity": "error",
  "message": "Fn type requires ->",
  "help": "write the function type as Fn(Args) -> Ret",
  "path": "a.mnd",
  "span": {
    "start": 10,
    "end": 20,
    "line": 1,
    "column": 11
  }
}
```

### `E_TYPE_LET`

- **Severity:** error
- **Meaning:** A `let` binding is incomplete.
- **Example:**
```menard
let
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload.
- **Fix:** Write `let name = expr`.
- **Help:** "write let as let name = expr"
- **Spec:** [syntax.md §5](syntax.md#5-expressions)

```json
{
  "code": "E_TYPE_LET",
  "severity": "error",
  "message": "let requires name and expression",
  "help": "write let as let name = expr",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 4,
    "line": 1,
    "column": 1
  }
}
```

### `E_TYPE_LOOP`

- **Severity:** error
- **Meaning:** A `loop` is missing bindings or a body.
- **Example:**
```menard
loop
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload.
- **Fix:** Write `loop (bindings) body`.
- **Help:** "write loop as loop (bindings) body"
- **Spec:** [menard-spec.md §2.4](menard-spec.md#24-control-flow)

```json
{
  "code": "E_TYPE_LOOP",
  "severity": "error",
  "message": "loop requires bindings and body",
  "help": "write loop as loop (bindings) body",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 4,
    "line": 1,
    "column": 1
  }
}
```

### `E_TYPE_MATCH`

- **Severity:** error
- **Meaning:** A `match` is missing a scrutinee or clauses.
- **Example:**
```menard
match
```
- **Note:** Surface syntax is rejected earlier by the reader; this code guards the core list form. The sample records the emit payload.
- **Fix:** Provide a scrutinee and pattern/body pairs.
- **Help:** "write match with a scrutinee and pattern/body pairs"
- **Spec:** [menard-spec.md §2.4](menard-spec.md#24-control-flow)

```json
{
  "code": "E_TYPE_MATCH",
  "severity": "error",
  "message": "match requires scrutinee and clauses",
  "help": "write match with a scrutinee and pattern/body pairs",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 4,
    "line": 1,
    "column": 1
  }
}
```

### `E_TYPE_MISMATCH`

- **Severity:** error
- **Meaning:** An expression has a type that does not match what was expected.
- **Example:**
```menard
1 + false
```
- **Fix:** Change the expression or the expected type.
- **Help:** "change the expression to match the expected type"
- **Spec:** [menard-spec.md §2.3](menard-spec.md#23-types)

```json
{
  "code": "E_TYPE_MISMATCH",
  "severity": "error",
  "message": "expected Bool, found Int",
  "help": "change the expression to match the expected type",
  "path": "a.mnd",
  "span": {
    "start": 4,
    "end": 9,
    "line": 1,
    "column": 5
  }
}
```

### `E_TYPE_NULLARY_CALL`

- **Severity:** error
- **Meaning:** A nullary constructor was called with parentheses.
- **Example:**
```menard
None()
```
- **Fix:** Write the constructor as a bare name.
- **Help:** "remove the parentheses; None is a value"
- **Spec:** [syntax.md §5](syntax.md#5-expressions)

```json
{
  "code": "E_TYPE_NULLARY_CALL",
  "severity": "error",
  "message": "nullary constructor None cannot be called",
  "help": "remove the parentheses; None is a value",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 6,
    "line": 1,
    "column": 1
  }
}
```

### `E_TYPE_OCCURS`

- **Severity:** error
- **Meaning:** Unification would build an infinite type.
- **Example:**
```menard
let omega(x: a) -> a =
  x(x)
```
- **Fix:** Break the recursive occurrence.
- **Help:** "break the cycle that makes this type infinite"
- **Spec:** [menard-spec.md §2.3](menard-spec.md#23-types)

```json
{
  "code": "E_TYPE_OCCURS",
  "severity": "error",
  "message": "infinite type",
  "help": "break the cycle that makes this type infinite",
  "path": "a.mnd",
  "span": {
    "start": 25,
    "end": 29,
    "line": 2,
    "column": 3
  }
}
```

### `E_TYPE_ORDERABLE`

- **Severity:** error
- **Meaning:** A value used where an orderable type is required is not orderable.
- **Example:**
```menard
compare(fn (x) = x, fn (y) = y)
```
- **Fix:** Use Int, Float, Str, Char, Bool, or a variant of those.
- **Help:** "only Int, Float, Str, Char, Bool, and variants of those are orderable"
- **Spec:** [menard-spec.md §2.12](menard-spec.md#212-three-predicates-showable-orderable-equatable)

```json
{
  "code": "E_TYPE_ORDERABLE",
  "severity": "error",
  "message": "type (Fn x -> x) is not orderable",
  "help": "only Int, Float, Str, Char, Bool, and variants of those are orderable",
  "path": "a.mnd",
  "span": {
    "start": 8,
    "end": 18,
    "line": 1,
    "column": 9
  }
}
```

### `E_TYPE_RECUR`

- **Severity:** error
- **Meaning:** `recur` appeared outside a `loop`.
- **Example:**
```menard
recur()
```
- **Fix:** Use `recur` only inside `loop`.
- **Help:** "use recur only inside a loop"
- **Spec:** [menard-spec.md §2.4](menard-spec.md#24-control-flow)

```json
{
  "code": "E_TYPE_RECUR",
  "severity": "error",
  "message": "recur outside loop",
  "help": "use recur only inside a loop",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 7,
    "line": 1,
    "column": 1
  }
}
```

### `E_TYPE_SHOWABLE`

- **Severity:** error
- **Meaning:** A value used with `show` / printing is not showable.
- **Example:**
```menard
show(fn (x) = x)
```
- **Fix:** Show a showable value, or format it yourself.
- **Help:** "use a showable type, or print via a custom function"
- **Spec:** [menard-spec.md §2.13](menard-spec.md#213-canonical-text-forms-normative)

```json
{
  "code": "E_TYPE_SHOWABLE",
  "severity": "error",
  "message": "type (Fn x -> x) is not showable",
  "help": "use a showable type, or print via a custom function",
  "path": "a.mnd",
  "span": {
    "start": 5,
    "end": 15,
    "line": 1,
    "column": 6
  }
}
```

### `E_TYPE_UNBOUND`

- **Severity:** error
- **Meaning:** A name, field, or constructor is not in scope.
- **Example:**
```menard
let x = n+1
```
- **Fix:** Bind the name, fix spelling, or space operators.
- **Help:** "bind the name, or check the spelling"
- **Help:** "check the spelling, or qualify the constructor with its import alias"
- **Help:** "operators need a space on both sides; did you mean `n + 1`?"
- **Spec:** [menard-spec.md §2.3](menard-spec.md#23-types)

```json
{
  "code": "E_TYPE_UNBOUND",
  "severity": "error",
  "message": "unbound variable n+1",
  "help": "operators need a space on both sides; did you mean `n + 1`?",
  "path": "a.mnd",
  "span": {
    "start": 8,
    "end": 11,
    "line": 1,
    "column": 9
  }
}
```

Unknown constructors and glued operators keep this code with specialized help. Plain unbound names use the generic help.

### `E_TYPE_UNKNOWN`

- **Severity:** error
- **Meaning:** A type name is not defined.
- **Example:**
```menard
let f(x: Int64) -> Int = 0
```
- **Fix:** Use a known type or define it.
- **Help:** "use a known type name, or define the type first"
- **Spec:** [menard-spec.md §2.3](menard-spec.md#23-types)

```json
{
  "code": "E_TYPE_UNKNOWN",
  "severity": "error",
  "message": "unknown type Int64",
  "help": "use a known type name, or define the type first",
  "path": "a.mnd",
  "span": {
    "start": 9,
    "end": 14,
    "line": 1,
    "column": 10
  }
}
```

### `E_PUB_PRIVATE_TYPE`

- **Severity:** error
- **Meaning:** A `pub` signature mentions a private type.
- **Example:**
```menard
type Hidden =
  | H(Int)

pub let make(n: Int) -> Hidden =
  H(n)
```
- **Fix:** Make the type `pub`, or keep it out of public signatures.
- **Help:** "make the type pub, or stop mentioning it in a pub signature"
- **Spec:** [menard-spec.md §2.7](menard-spec.md#27-modules-exports-and-foreign-functions)

```json
{
  "code": "E_PUB_PRIVATE_TYPE",
  "severity": "error",
  "message": "pub signature mentions private type Hidden",
  "help": "make the type pub, or stop mentioning it in a pub signature",
  "path": "a.mnd",
  "span": {
    "start": 26,
    "end": 65,
    "line": 4,
    "column": 1
  }
}
```

### `E_IMPORT`

- **Severity:** error
- **Meaning:** An import form is invalid, or a re-export names something the module does not export.
- **Example:**
```menard
pub import "./color.mnd" (Missing)
```
- **Fix:** Write a valid import path and export list.
- **Help:** "fix the import form"
- **Spec:** [menard-spec.md §2.7](menard-spec.md#27-modules-exports-and-foreign-functions)

```json
{
  "code": "E_IMPORT",
  "severity": "error",
  "message": "module does not export Missing",
  "help": "fix the import form",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 34,
    "line": 1,
    "column": 1
  }
}
```

### `E_IMPORT_CYCLE`

- **Severity:** error
- **Meaning:** Modules import each other in a cycle.
- **Example:**
```menard
import "./b.mnd"
```
- **Fix:** Break the cycle.
- **Help:** "break the import cycle"
- **Spec:** [menard-spec.md §2.7](menard-spec.md#27-modules-exports-and-foreign-functions)

```json
{
  "code": "E_IMPORT_CYCLE",
  "severity": "error",
  "message": "import cycle: /a.mnd -> /b.mnd -> /a.mnd",
  "help": "break the import cycle",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 16,
    "line": 1,
    "column": 1
  }
}
```

### `E_IMPORT_MISSING`

- **Severity:** error
- **Meaning:** The imported module file was not found.
- **Example:**
```menard
import "./missing.mnd"
```
- **Fix:** Create the file or fix the path.
- **Help:** "create the module or fix the import path"
- **Spec:** [menard-spec.md §2.7](menard-spec.md#27-modules-exports-and-foreign-functions)

```json
{
  "code": "E_IMPORT_MISSING",
  "severity": "error",
  "message": "module not found: /missing.mnd",
  "help": "create the module or fix the import path",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 22,
    "line": 1,
    "column": 1
  }
}
```

### `E_IMPORT_VERSION`

- **Severity:** error
- **Meaning:** The same GitHub package is imported at two versions.
- **Example:**
```menard
import github:o/r@v1/a
import github:o/r@v2/b
```
- **Fix:** Agree on one version.
- **Help:** "use one version of the package across imports"
- **Spec:** [menard-spec.md §2.7](menard-spec.md#27-modules-exports-and-foreign-functions)

```json
{
  "code": "E_IMPORT_VERSION",
  "severity": "error",
  "message": "two versions of o/r: v1 and v2",
  "help": "use one version of the package across imports",
  "path": "a.mnd",
  "span": {
    "start": 23,
    "end": 45,
    "line": 2,
    "column": 1
  }
}
```

### `E_EXTERN_FFI_PREFIX`

- **Severity:** error
- **Meaning:** An `extern` in an `/ffi/` module declares an `mn_*` name (or a seam module omits `mn_*`).
- **Example:**
```menard
extern mn_exists(path: Str) -> Bool
```
- **Note:** Diagnosed in an `/ffi/` module path.
- **Fix:** Use `mn_*` only in seam modules; keep FFI names elsewhere.
- **Help:** "use the mn_ prefix only in seam modules"
- **Spec:** [menard-spec.md §2.7](menard-spec.md#27-modules-exports-and-foreign-functions)

```json
{
  "code": "E_EXTERN_FFI_PREFIX",
  "severity": "error",
  "message": "FFI modules must not declare mn_* (keep Runtime ABI in the seam)",
  "help": "use the mn_ prefix only in seam modules",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 35,
    "line": 1,
    "column": 1
  }
}
```

### `E_EXTERN_SEAM`

- **Severity:** error
- **Meaning:** `extern` appears outside a seam or `/ffi/` module.
- **Example:**
```menard
extern mn_foo() -> Int
```
- **Fix:** Move the declaration into an allowed module.
- **Help:** "move the extern into a seam or /ffi/ module"
- **Spec:** [menard-spec.md §2.7](menard-spec.md#27-modules-exports-and-foreign-functions)

```json
{
  "code": "E_EXTERN_SEAM",
  "severity": "error",
  "message": "extern is confined to seam modules (sys, io, fs, proc, time, sched, net) or /ffi/ modules",
  "help": "move the extern into a seam or /ffi/ module",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 22,
    "line": 1,
    "column": 1
  }
}
```

### `E_RUNTIME_MODULE`

- **Severity:** error
- **Meaning:** A `runtime` form appears outside an allowed stdlib module.
- **Example:**
```menard
runtime foo() -> Int
```
- **Fix:** Move it into string, map, or string-buffer.
- **Help:** "move the runtime form into an allowed stdlib module"
- **Spec:** [menard-spec.md §2.7](menard-spec.md#27-modules-exports-and-foreign-functions)

```json
{
  "code": "E_RUNTIME_MODULE",
  "severity": "error",
  "message": "runtime is confined to stdlib string, map, and string-buffer",
  "help": "move the runtime form into an allowed stdlib module",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 20,
    "line": 1,
    "column": 1
  }
}
```

### `E_TEST`

- **Severity:** error
- **Meaning:** A `@test` assertion failed while running tests.
- **Example:**
```menard
@test 1 == 2
```
- **Note:** Emitted by `mn test` (not `mn check`) when an `@test` assertion fails. Message shape: `assertion failed: <name>`.
- **Fix:** Fix the assertion or the code under test.
- **Help:** "fix the failing assertion"
- **Spec:** [syntax.md §7](syntax.md#7-test-annotations)

```json
{
  "code": "E_TEST",
  "severity": "error",
  "message": "assertion failed: example",
  "help": "fix the failing assertion",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 12,
    "line": 1,
    "column": 1
  }
}
```

## Lower

The IR lowering pass has no diagnostic codes yet. Failures at this stage are compiler bugs rather than user-facing `E_*` / `W_*` codes.

## Runtime

Runtime panics are not `E_*` / `W_*` codes. Under `--json` they are a separate `{ "kind": "panic", … }` object on stderr; see [diagnostics.md](diagnostics.md).

## Reserved

These codes appear in the DOC-05 review scope but are **not emitted yet**. They
are reserved here so the catalogue names them; they must not gain a `###`
section (and must not appear in the sync test's emitted set) until their owning
item lands real emit sites. Codes stay stable: when introduced they keep these
ids rather than inventing new ones for the same meaning.

### Reserved catalogue (not emitted)

Each entry below has the same fields a live `###` section will get when the
owning item ships. Severity for `W_*` is warning; the rest are errors.

#### `E_TYPE_QUESTION_RETURN`

- **Severity:** error
- **Meaning:** A `?` / `??` expression does not match the enclosing return type.
- **Example:** (LANG-06) a `?` used where the function does not return `Maybe`/`Result`.
- **Fix:** Align the return type with `?` propagation, or drop the `?`.
- **Help:** (to be curated with LANG-06)
- **Spec:** [menard-spec.md §2.5](menard-spec.md#25-evaluation) (LANG-06)
- **Owning item:** LANG-06

#### `E_OPERATOR_SPACING`

- **Severity:** error
- **Meaning:** Reserved only. Operator-spacing help stays on `E_TYPE_UNBOUND` /
  `E_PARSE` (see those sections). This id is reserved so a later split, if ever
  chosen, does not collide.
- **Example:** `let x = n+1` (today emits `E_TYPE_UNBOUND`)
- **Fix:** Put spaces around the operator.
- **Help:** (not emitted; see `E_TYPE_UNBOUND`)
- **Spec:** [syntax.md §1](syntax.md#1-lexical-syntax)
- **Owning item:** LANG-09

#### `E_TYPE_LOCAL_POLY`

- **Severity:** error
- **Meaning:** Misuse of explicit-parameter local polymorphism.
- **Example:** (LANG-11) ordinary local `let` treated as polymorphic, or a
  forbidden generalization.
- **Fix:** Use an explicit-parameter local function, or keep the binding monomorphic.
- **Help:** (to be curated with LANG-11)
- **Spec:** [menard-spec.md §2.3](menard-spec.md#23-types)
- **Owning item:** LANG-11

#### `E_UNSUPPORTED`

- **Severity:** error
- **Meaning:** A typed surface is unsupported in this host (e.g. net in the interpreter).
- **Example:** (interpreter net) calling a native-only API under the interpreter.
- **Fix:** Run under the native build, or avoid the API.
- **Help:** (to be curated with the interpreter-net work)
- **Spec:** [diagnostics.md](diagnostics.md)
- **Owning item:** interpreter net

#### `W_PATTERN_UNREACHABLE`

- **Severity:** warning
- **Meaning:** A match arm can never be reached.
- **Example:** (LANG-13) an arm after a catch-all.
- **Fix:** Remove or reorder the arm.
- **Help:** (to be curated with LANG-13)
- **Spec:** [menard-spec.md §2.4](menard-spec.md#24-control-flow)
- **Owning item:** LANG-13

#### `W_PATTERN_REDUNDANT`

- **Severity:** warning
- **Meaning:** A match arm is redundant with an earlier arm.
- **Example:** (LANG-13) a duplicate constructor arm.
- **Fix:** Remove the redundant arm.
- **Help:** (to be curated with LANG-13)
- **Spec:** [menard-spec.md §2.4](menard-spec.md#24-control-flow)
- **Owning item:** LANG-13
