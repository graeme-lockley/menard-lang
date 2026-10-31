/**
 * The three prompt contracts the loop depends on: plan, implement (and fix),
 * and an adversarial review with a machine-readable verdict.
 *
 * These are the part of the loop that is judgement, so they are written as
 * contracts rather than as chat: fixed sections out, fixed rules in.
 */
import type { Row } from "../next.ts";

const HOUSE_RULES = `Non-negotiable rules:
1. Production quality. No stubs, TODOs, FIXMEs, disabled or skipped tests, dead code, or "follow-up" for anything in scope.
2. Both routes agree. The interpreter and the native build must behave the same, or the difference is documented, typed, and tested — see the review's standing acceptance criteria. A fix on one path is not a fix.
3. Evidence, not claims. Every acceptance criterion needs a test that fails without the change.
4. Never weaken a gate. Do not delete, skip, or loosen a test, assertion, lint, or check to get green.
5. Focused diff. No unrelated refactors, renames, or formatting churn.
6. Docs are part of the change: update exactly the documents the review names, and docs/backlog.md as its "Definition of done" requires.
7. Do not commit, amend, push, stage, or open a pull request. Leave the working tree dirty for the driver.`;

const GATE_OWNERSHIP = `The driver owns the full gate. It runs 'make', 'make ci', './mn test', and 'make check-fixed-point' when the change needs it, immediately after you finish.
Do not run those yourself, and do not run 'make test' or 'make bootstrap': repeating the suite only duplicates the driver's run.
Iterate with the narrowest targeted check instead: 'bun test <file>', './mn run <fixture>', 'make typecheck'.`;

export function planPrompt(input: { row: Row; specification: string; reviewFile: string }): string {
  const { row, specification, reviewFile } = input;
  return `You are planning one item of the Menard backlog. The repository is the working directory.

Item: ${row.id} — ${row.title}
Area: ${row.area} · priority ${row.priority} · phase ${row.phase}
Issue: ${row.issue}
Review anchor: ${reviewFile}#${row.id.toLowerCase()}
Backlog row: docs/backlog.md

The review section below is the specification. Its acceptance criteria are the contract; every one must be met.

<specification>
${specification}
</specification>

Read the code before planning: the files named in Scope, their tests, and the nearest existing pattern for the same kind of change. Do not invent APIs.

Output a plan with exactly these sections:

## Scope
Which files and modules change, and what each one gets.

## Acceptance criteria → evidence
A table with one row per acceptance criterion: the criterion, the change that satisfies it, and the test or command that proves it. "It works" is not evidence; name the test.

## Steps
Ordered steps that each leave the tree buildable. For each: the change, and the command that verifies it.

## Agreement and regression
How the interpreter and the native build stay in agreement, which existing tests could break, and the regression test that would have caught this bug.

## Out of scope
What this item deliberately does not do.

Rules:
- Plan for production quality, not for a first draft.
- Prefer the smallest diff that satisfies the criteria.
- The compiler bootstraps itself, so a change under src/ or stdlib/ may have to keep the fixed point green; say how you will check that.
- Never weaken a check to get green.

Output only the plan. Do not edit files.`;
}

export function executePrompt(input: { row: Row; plan: string; reviewFile: string }): string {
  const { row, plan, reviewFile } = input;
  return `You are implementing ${row.id} in the Menard repository. The working directory is the repo root.

Follow this plan:

<plan>
${plan}
</plan>

The contract is the acceptance criteria at ${reviewFile}#${row.id.toLowerCase()}; the plan's evidence table is how you prove them.

${HOUSE_RULES}

${GATE_OWNERSHIP}

When you are done, reply with:
- Files changed, grouped by purpose.
- A criterion-by-criterion statement of what satisfies each one.
- Anything you could not do, and why. Do not claim success you have not verified.`;
}

export function fixPrompt(input: {
  row: Row;
  plan: string;
  reviewFile: string;
  failedGate: string | null;
  gateOutput: string;
  gaps: string[];
}): string {
  const { row, plan, reviewFile, failedGate, gateOutput, gaps } = input;
  const gate =
    failedGate === null
      ? "The gate passed, but an independent review found the work incomplete."
      : `The gate failed at: ${failedGate}`;
  const gapList = gaps.length === 0 ? "(the reviewer reported no gaps)" : gaps.map((gap) => `- ${gap}`).join("\n");
  return `You are fixing ${row.id} in the Menard repository. The previous attempt did not pass.

${gate}

<failure>
${gateOutput}
</failure>

<review-gaps>
${gapList}
</review-gaps>

<plan>
${plan}
</plan>

The contract is still the acceptance criteria at ${reviewFile}#${row.id.toLowerCase()}. Fix the causes. Do not work around the checks, and do not edit a test to match broken behaviour.

${HOUSE_RULES}

${GATE_OWNERSHIP}

When you are done, reply with what you changed, and how each failing check is now satisfied.`;
}

export function reviewPrompt(input: {
  row: Row;
  specification: string;
  base: string;
  stat: string;
  changed: string;
  diff: string;
}): string {
  const { row, specification, base, stat, changed, diff } = input;
  return `You are an adversarial reviewer with fresh context. Assume nothing the implementer wrote; check the repository itself. The working directory is the repo root.

This session is read-only: shell commands are rejected, so you cannot run the suite. The driver has already run the gate and it passed. Judge from the diff, the code, and the tests.

Item: ${row.id} — ${row.title}
Change: uncommitted work in the working tree, on top of ${base}.

Changed files:
<changed>
${changed}
</changed>

Diffstat:
<stat>
${stat}
</stat>

Diff (truncated when long):
<diff>
${diff}
</diff>

The specification:
<specification>
${specification}
</specification>

For every acceptance criterion, decide met / partial / missing by reading the code and the tests — not the commit message. Then look specifically for:
- stubs, TODO/FIXME, dead code, '@test true', skipped or disabled tests, or a fallback that hides a failure;
- a native path fixed without the interpreter (or the reverse), or a documented boundary that is not typed and tested;
- tests that would pass with the old behaviour: they assert nothing, or assert the wrong thing;
- documentation claims the code does not support;
- a docs/backlog.md row marked done for a criterion that is not actually met.

Read the files you need; do not modify files, do not commit, do not push.

Output JSON only, with no prose before or after:
{"satisfied": true, "criteria": [{"criterion": "...", "status": "met|partial|missing", "evidence": "path:line or test name"}], "gaps": ["..."], "notes": "one paragraph"}`;
}
