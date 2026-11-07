---
name: menard-plan
description: Plan one Menard backlog item against its acceptance criteria. Use when the loop driver asks for a plan for a review item.
---

# Planning a Menard item

You are planning, not implementing. The plan is the contract the next session
follows, so it has to be specific enough to check.

## Inputs

- the item id and title;
- the review section, quoted in the prompt — this is the specification;
- the acceptance criteria as `AC1 … ACn`.

## Method

1. Read the files the review's Scope names, their tests, and the nearest
   existing pattern for the same kind of change. Do not invent APIs.
2. Read the item's row in `docs/backlog.md` and the decisions it touches in
   `docs/decisions.md`.
3. For every AC, decide the change and the test that proves it. If you cannot
   name a test, the plan is not finished: say so rather than guessing.
4. If an AC claims live fidelity (samples match `mn check --json`, help matches
   emitters, docs match code, …), the evidence row must name a **sync test**
   that compares the claim to the live source — not a one-shot manual regen.
5. Keep the interpreter and the native build in agreement; say how you will
   check that.
6. Write the plan with the plan tool, or as your final message if the tool is
   unavailable, then stop.

## Required shape

## Scope

Which files change, and what each one gets.

## Acceptance criteria → evidence

One row per AC, keyed by its id:

| AC | Change | Evidence (file:test) | Command |
| --- | --- | --- | --- |
| AC1 | … | `tests/actor/call-death.mnd` | `./mn test tests/actor` |

The driver's plan gate fails when an AC has no row. A row with no command is a
plan that has not been thought through.

## Steps

Ordered steps that each leave the tree buildable.

## Agreement and regression

How interpreter and native stay in agreement, and the regression test that
would have caught the bug.

## Out of scope

What this item deliberately does not do.

Do **not** put an identifier in Out of scope if the review **Scope** or an AC
requires it, unless you also add an explicit override line:

```
AC override: Scope names `E_FOO` for completeness; AC1 only requires emitted
codes, so `E_FOO` is reserved-only (not a ### catalogue section).
```

The driver fails the plan when Out of scope declines a Scope/AC identifier
without such an override (the DOC-05 failure mode).

## Rules

- Do not implement, commit, push, or open a pull request.
- Do not plan a full-suite run: the driver owns the gate.
- Do not weaken a check to make the plan easier.
