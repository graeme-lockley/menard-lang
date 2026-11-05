# Error codes

Catalogue of every emitted `E_*` diagnostic code with a sample JSON
object (schema version 1). Meaning, fix guidance, and spec links are expanded
under DOC-05. Schema details: [diagnostics.md](diagnostics.md).

## `E_CASING`

```json
{
  "code": "E_CASING",
  "severity": "error",
  "message": "type constructor must begin with an uppercase letter",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_DESUGAR_ARITY`

```json
{
  "code": "E_DESUGAR_ARITY",
  "severity": "error",
  "message": "operator expects two arguments",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_DESUGAR_COND_CLAUSE`

```json
{
  "code": "E_DESUGAR_COND_CLAUSE",
  "severity": "error",
  "message": "cond clause must be a guard/body pair",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_DESUGAR_COND_ELSE`

```json
{
  "code": "E_DESUGAR_COND_ELSE",
  "severity": "error",
  "message": "cond else must be last",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_DESUGAR_COND_EMPTY`

```json
{
  "code": "E_DESUGAR_COND_EMPTY",
  "severity": "error",
  "message": "cond requires at least one clause",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_DESUGAR_MAP`

```json
{
  "code": "E_DESUGAR_MAP",
  "severity": "error",
  "message": "malformed map literal",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_DESUGAR_MATCH`

```json
{
  "code": "E_DESUGAR_MATCH",
  "severity": "error",
  "message": "malformed match",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_DESUGAR_PIPE`

```json
{
  "code": "E_DESUGAR_PIPE",
  "severity": "error",
  "message": "pipe requires a call on the right",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_DESUGAR_WHEN`

```json
{
  "code": "E_DESUGAR_WHEN",
  "severity": "error",
  "message": "when requires a condition and a body",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_DESUGAR_WHILE`

```json
{
  "code": "E_DESUGAR_WHILE",
  "severity": "error",
  "message": "while requires a condition and a body",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_EXTERN_FFI_PREFIX`

```json
{
  "code": "E_EXTERN_FFI_PREFIX",
  "severity": "error",
  "message": "extern name must use the mn_ prefix",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_EXTERN_SEAM`

```json
{
  "code": "E_EXTERN_SEAM",
  "severity": "error",
  "message": "extern is not a declared seam",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_IMPORT`

```json
{
  "code": "E_IMPORT",
  "severity": "error",
  "message": "malformed import",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_IMPORT_CYCLE`

```json
{
  "code": "E_IMPORT_CYCLE",
  "severity": "error",
  "message": "import cycle",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_IMPORT_MISSING`

```json
{
  "code": "E_IMPORT_MISSING",
  "severity": "error",
  "message": "import not found",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_IMPORT_VERSION`

```json
{
  "code": "E_IMPORT_VERSION",
  "severity": "error",
  "message": "import version mismatch",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_PARSE`

```json
{
  "code": "E_PARSE",
  "severity": "error",
  "message": "unexpected character",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_PARSE_BANG`

```json
{
  "code": "E_PARSE_BANG",
  "severity": "error",
  "message": "unexpected '!'",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_PARSE_STRING`

```json
{
  "code": "E_PARSE_STRING",
  "severity": "error",
  "message": "unterminated string",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_PARSE_UNCLOSED`

```json
{
  "code": "E_PARSE_UNCLOSED",
  "severity": "error",
  "message": "unclosed {",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_PUB_PRIVATE_TYPE`

```json
{
  "code": "E_PUB_PRIVATE_TYPE",
  "severity": "error",
  "message": "pub signature mentions private type Foo",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_RUNTIME_MODULE`

```json
{
  "code": "E_RUNTIME_MODULE",
  "severity": "error",
  "message": "runtime form outside a runtime module",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TEST`

```json
{
  "code": "E_TEST",
  "severity": "error",
  "message": "assertion failed: example",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_ARITY`

```json
{
  "code": "E_TYPE_ARITY",
  "severity": "error",
  "message": "function arity mismatch: expected 2, found 1",
  "help": "check the call: expected and found argument counts must match",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_DEFN`

```json
{
  "code": "E_TYPE_DEFN",
  "severity": "error",
  "message": "defn missing return type",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_DUPLICATE`

```json
{
  "code": "E_TYPE_DUPLICATE",
  "severity": "error",
  "message": "duplicate definition",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_EXHAUSTIVE`

```json
{
  "code": "E_TYPE_EXHAUSTIVE",
  "severity": "error",
  "message": "non-exhaustive match: missing Red",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_EXPR`

```json
{
  "code": "E_TYPE_EXPR",
  "severity": "error",
  "message": "invalid type expression",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_FN`

```json
{
  "code": "E_TYPE_FN",
  "severity": "error",
  "message": "Fn type requires ->",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_LET`

```json
{
  "code": "E_TYPE_LET",
  "severity": "error",
  "message": "let requires name and expression",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_LOOP`

```json
{
  "code": "E_TYPE_LOOP",
  "severity": "error",
  "message": "loop requires bindings and body",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_MATCH`

```json
{
  "code": "E_TYPE_MATCH",
  "severity": "error",
  "message": "match requires scrutinee and clauses",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_MISMATCH`

```json
{
  "code": "E_TYPE_MISMATCH",
  "severity": "error",
  "message": "expected Int, found Bool",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_NULLARY_CALL`

```json
{
  "code": "E_TYPE_NULLARY_CALL",
  "severity": "error",
  "message": "nullary constructor None cannot be called",
  "help": "remove the parentheses; None is a value",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_OCCURS`

```json
{
  "code": "E_TYPE_OCCURS",
  "severity": "error",
  "message": "infinite type",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_ORDERABLE`

```json
{
  "code": "E_TYPE_ORDERABLE",
  "severity": "error",
  "message": "type Ref is not orderable",
  "help": "only Int, Float, Str, Char, Bool, and variants of those are orderable",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_RECUR`

```json
{
  "code": "E_TYPE_RECUR",
  "severity": "error",
  "message": "recur outside loop",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_REST`

```json
{
  "code": "E_TYPE_REST",
  "severity": "error",
  "message": "rest parameter type must be a List",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_SHOWABLE`

```json
{
  "code": "E_TYPE_SHOWABLE",
  "severity": "error",
  "message": "type Fn is not showable",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_SPREAD`

```json
{
  "code": "E_TYPE_SPREAD",
  "severity": "error",
  "message": "spread on a function with no rest parameter",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_UNBOUND`

```json
{
  "code": "E_TYPE_UNBOUND",
  "severity": "error",
  "message": "unknown constructor",
  "help": "check the spelling, or qualify the constructor with its import alias",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

## `E_TYPE_UNKNOWN`

```json
{
  "code": "E_TYPE_UNKNOWN",
  "severity": "error",
  "message": "unknown type Int64",
  "path": "a.mnd",
  "span": {
    "start": 0,
    "end": 1,
    "line": 1,
    "column": 1
  }
}
```

