# Diagnostics

Menard diagnostics are a single model shared by the host CLI
(`bun run host/src/cli/menard.ts`), the native `mn` driver, and (TOOL-04) the
language server. Text form is for humans; `--json` is for editors, agents, and
CI.

## Text form

```
path:line:col: error[CODE]: message
  |
N |   source line
  |      ^^^^
help: optional fix hint
  = note: optional note
```

Column is a 1-based byte offset on the line. Color is applied only when
stderr is a terminal and `NO_COLOR` is unset. Diagnostics with no `help` keep
the header, snippet, and notes only (byte-compatible with earlier fixtures).

## JSON form (`--json`)

`mn check --json`, `mn build --json`, `mn test --json` (compile / assertion
diagnostics), and the compile phase of `mn run --json` write **one JSON
object** to **stdout**. No human diagnostic text is mixed in.
A successful check writes an empty list:

```json
{ "version": 1, "diagnostics": [] }
```

### Schema version 1

| Field | Type | Notes |
| --- | --- | --- |
| `version` | number | Currently `1`. |
| `diagnostics` | array | Zero or more diagnostic objects. |

Each diagnostic:

| Field | Type | Notes |
| --- | --- | --- |
| `code` | string | Stable id, e.g. `E_PARSE_UNCLOSED`. |
| `severity` | `"error"` \| `"warning"` | |
| `message` | string | One line; no paths or addresses. |
| `help` | string | Optional. Omitted when absent (never `null`). |
| `path` | string | File path shown to the user. |
| `span` | object | `{ start, end, line, column }` — byte offsets and 1-based line/column. |

Example (compile error):

```json
{
  "version": 1,
  "diagnostics": [
    {
      "code": "E_TYPE_NULLARY_CALL",
      "severity": "error",
      "message": "nullary constructor None cannot be called",
      "help": "remove the parentheses; None is a value",
      "path": "a.mnd",
      "span": { "start": 0, "end": 6, "line": 1, "column": 1 }
    }
  ]
}
```

### Runtime panic (`mn run --json`)

A runtime panic is **not** wrapped into the program's stdout. It is one JSON
object on **stderr**:

```json
{
  "kind": "panic",
  "message": "boom",
  "path": "a.mnd",
  "span": { "start": 0, "end": 12, "line": 1, "column": 1 },
  "frames": [
    { "path": "a.mnd", "span": { "start": 0, "end": 12, "line": 1, "column": 1 } }
  ]
}
```

Native panics honor `MENARD_JSON_DIAG=1` (set by `mn run --json` before exec).
User panics never include a JavaScript / `MENARD_STACK` interpreter dump.

## Codes and samples

Every emitted `E_*` code and a sample JSON object live in
[errors.md](errors.md). Actionable codes that exist today carry `help` in both
text and JSON (nullary call, orderability, function/closure arity, unbound
constructor, operator-spacing hints on `E_TYPE_UNBOUND` / glued `E_PARSE`).
`?`/`??` return-type diagnostics and their `help` lines remain LANG-06.

## LSP

TOOL-04 (`mn lsp`) publishes the same diagnostic model — same `code`,
`message`, `help`, and `span` — via `textDocument/publishDiagnostics`.
