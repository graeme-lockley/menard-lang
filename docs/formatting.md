# Formatting

Canonical layout for Menard source, produced by `mn fmt` and checked by
`mn fmt --check` / `make fmt-check`.

## Indentation

- Indent with **2 spaces**. Tabs in leading whitespace are a lexical error;
  the formatter never emits them.
- Arms of `match`, `cond`, and `type` start with `| ` at the arm indent
  (base indent + 2). Nested or heavy `if` stays `if` — the formatter never
  rewrites `if` to `cond` or `when` to `if`.

## Blocks and braces

- A function or `let` body that is a block prints as
  `… {` / indented statements / `}` with the closing brace at the block's
  indent.
- `defer expr` is always one line inside a block; its scope is that block.

## Operators

- Where the AST already contains a binary operator, the formatter prints
  **exactly one space** on each side (`1 + 2`, `a && b`, `x ? 0`, `x ?? 0`).
- Identifier bytes are never rewritten. `n+1` is one identifier and stays
  `n+1`; the LANG-09 diagnostic explains glued operators that should have
  been spaced.
- Pipe `|>` and cons `::` follow the same one-space rule.

## Constructors and calls

- Bare nullary constructors print as `None`, not `None()`.
- Payload constructors and records print as calls: `Some(1)`, `Point(1, 2)`.
- Call arguments hang to the next line only when an argument's own print
  already needs a newline (for example a `match` argument). There is
  **no column wrap** and no fixed line-length budget.

## Imports

- Consecutive `import` forms are packed with a single newline between them
  (no blank line).
- A blank line separates an import block from the next non-import form.
- Import paths and aliases are not sorted or rewritten.

## Blank lines

- Between non-import top-level forms: exactly one blank line.
- Blank lines that only separate full-line comments in a leading trivia
  group are preserved; blank lines that merely separated forms are owned
  by the policy above and are not stacked on re-format.

## Comments

- Full-line `;…` comments are preserved, including `; @test`, `; @module`,
  documentation comments, and `; #source` generated-line mappings.
- A shebang (`#!…`) on line 1 is preserved.
- End-of-line comments that share a code line are **not** supported trivia;
  only full-line comments round-trip through `mn fmt`.

## `@test` layout

- `; @test …` stays a comment line immediately above the form it documents.
- Multi-line `; @test { … }` blocks keep their comment lines and indent
  with the surrounding trivia.

## Idempotence

`fmt(fmt(x)) == fmt(x)` for every well-formed `.mnd` file. Formatting does
not change the reader's AST (structural equality ignoring spans).

## Commands

```bash
mn fmt path/to/file.mnd          # rewrite in place
mn fmt --check path/to/file.mnd  # unified diff on stderr; exit 1 if dirty
mn fmt --stdin                   # read stdin, write formatted stdout
make fmt-check                   # check src/, stdlib/, examples/, tests/
```

`make fmt-check` skips `tests/negative/` — those fixtures are intentionally
unparseable and are not formatting subjects.
