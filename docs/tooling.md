# Tooling

Commands provided by `./mn` (native) and `bun run host/src/cli/menard.ts`
(host).

| Command | Role |
| --- | --- |
| `mn check` | Typecheck a `.mnd` file (`--json` for machine-readable diagnostics) |
| `mn emit` | Emit LLVM bitcode |
| `mn build` | Compile to a native binary |
| `mn run` | Compile and run |
| `mn test` | Run `@test` lines / `*.test.mnd` suites |
| `mn inter` | Reference interpreter on the TypeScript host |
| `mn fmt` | Format `.mnd` files (see [formatting.md](formatting.md)) |

## `mn fmt`

```bash
mn fmt path/to/file.mnd…           # rewrite in place
mn fmt --check path/to/file.mnd…   # unified diff on stderr; exit 1 if dirty
mn fmt --stdin                     # format stdin → stdout
make fmt-check                     # CI target over src/, stdlib/, examples/, tests/
```

Canonical style: [formatting.md](formatting.md). The host CLI
(`menard fmt`) accepts the same flags.

## Diagnostics

Prefer `mn check --json` for structured errors — see [diagnostics.md](diagnostics.md)
and [AGENTS.md](../AGENTS.md).
