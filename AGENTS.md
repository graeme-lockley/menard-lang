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

## Formatting before a commit

The **last step before a commit** that touches `.mnd` files is to format
them:

```bash
mn fmt path/to/touched.mnd…          # or: bun run host/src/cli/menard.ts fmt …
mn fmt --check path/to/touched.mnd…  # verify; exit 1 with a diff if dirty
make fmt-check                       # whole trees: src/, stdlib/, examples/, tests/
```

Canonical style: [`docs/formatting.md`](docs/formatting.md). Tooling overview:
[`docs/tooling.md`](docs/tooling.md).
