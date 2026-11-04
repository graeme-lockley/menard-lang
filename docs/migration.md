# Migrations

Breaking surface changes and how to rewrite existing code. Edition selection
(OTH-10) can lag; each entry below is enough to migrate by hand or with
`mn fix`.

## LANG-07 — Nullary constructors are values

**Was.** A nullary constructor was a zero-argument function. Programs wrote
`None()`, `Red()`, `JsonNull()`, `GET()`, `Permanent()`, and so on.

**Is.** A nullary constructor is a value of its nominal type. Write the bare
name: `None`, `Red`, `JsonNull`, `GET`, `Permanent`. The call form is
`E_TYPE_NULLARY_CALL` with help to remove the parentheses.

**Unchanged.** Payload constructors stay calls (`Some(1)`, `Rgb(1, 2, 3)`).
Zero-argument functions stay calls (`Map.empty()`). Patterns were already
bare (`| None ->`) and stay that way; any `| Name() ->` should become
`| Name ->`.

**Codemod.**

```
menard fix --rule nullary-ctor path/to/file.mnd
menard fix --dry-run --rule nullary-ctor path/to/file.mnd
```

The rule is idempotent. It rewrites expression-position nullary calls only;
it does not strip `()` from payload constructors or zero-argument functions,
and it does not rewrite match patterns (fix those by hand if they still use
`Name()`).

Rewrites are **byte-accurate**: edits use the reader's UTF-8 byte spans
(`host/src/reader/span.ts`) via the shared applicator
`host/src/fix/apply-rewrites.ts` (`applyByteRewrites`). Unrelated bytes —
including non-ASCII comments/strings and `\n` / `\r\n` line endings — are
copied unchanged. TOOL-12 rules must reuse this contract and must not slice
JavaScript strings with parser byte offsets.

**Edition.** Tied to OTH-10 when editions land; until then this is a flag-day
change for anyone on the old call form.
