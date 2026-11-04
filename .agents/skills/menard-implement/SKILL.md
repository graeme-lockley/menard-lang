---
name: menard-implement
description: Implement one planned Menard backlog item under the loop driver. Use when the loop driver hands you a plan and acceptance criteria.
---

# Implementing a planned Menard item

Follow the global `implement` skill's method — TDD at agreed seams, typecheck
regularly, single test files while iterating — with the overrides below, which
win wherever they disagree.

## Overrides

- **Do not commit, stage, push, or open a pull request.** The driver owns the
  git boundary and commits the tree itself.
- **Do not run the full suite.** That is `make test`, `make ci`, `./mn test`, and
  `make check-fixed-point`. The driver runs the gate immediately after you
  finish; repeating it only duplicates work.
- Iterate with the narrowest check: `bun test <file>`, `./mn run <fixture>`,
  `make typecheck`.
- Write your summary to the path the prompt gives you. The driver reads that
  file for the commit message and PR body.
- Follow the plan's AC table. If the plan and an acceptance criterion disagree,
  the acceptance criterion wins, and say so in the summary.
- Do not weaken a check to get green: no skipped tests, no loosened assertions,
  no `@test true`.
