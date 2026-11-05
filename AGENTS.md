# Agent notes

## Machine-readable diagnostics

Prefer structured errors over parsing caret diagrams:

```bash
./mn check --json path/to/file.mnd
bun run host/src/cli/menard.ts check --json path/to/file.mnd
```

Stdout is one JSON object `{ "version": 1, "diagnostics": [ … ] }` (schema in
[`docs/diagnostics.md`](docs/diagnostics.md)). Each diagnostic has
`code`, `severity`, `message`, optional `help`, `path`, and
`span: { start, end, line, column }`. No human text is interleaved on stdout.

`mn build --json`, `mn test --json`, and the compile phase of `mn run --json`
use the same schema. A runtime panic under `--json` is one
`{ "kind": "panic", … }` object on **stderr**; the program's own stdout is
unchanged.

The language server (TOOL-04, `mn lsp`) consumes this same diagnostic model.
Code catalogue and sample objects: [`docs/errors.md`](docs/errors.md).
