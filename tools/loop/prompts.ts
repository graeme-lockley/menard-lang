/**
 * The prompt contracts the loop depends on: plan, implement (and fix), and an
 * adversarial review with a machine-readable verdict.
 *
 * The method lives in the skills under `.agents/skills/` — the same skills a
 * person uses when driving Cursor by hand. A prompt here carries only the
 * task data and the machine contract: acceptance-criteria ids, output paths,
 * and the JSON shape.
 */
import type { Row } from "../next.ts";
import type { AcceptanceCriterion } from "./lib.ts";

const NO_COMMIT = "Do not commit, stage, push, or open a pull request — the driver owns the git boundary.";
const NO_GATE =
  "Do not run the full suite (`make test`, `make ci`, `./mn test`, `make check-fixed-point`); the driver runs the gate immediately after you finish.";

function criteriaBlock(criteria: AcceptanceCriterion[]): string {
  if (criteria.length === 0) return "(the review section has no acceptance criteria; its Scope is the contract)";
  return criteria.map((criterion) => `- ${criterion.id}: ${criterion.text}`).join("\n");
}

export function planPrompt(input: {
  row: Row;
  specification: string;
  reviewFile: string;
  criteria: AcceptanceCriterion[];
  skillPath: string;
}): string {
  const { row, specification, reviewFile, criteria, skillPath } = input;
  return `Read ${skillPath} and follow it. It defines the plan's required shape, and the driver checks that shape.

Item: ${row.id} — ${row.title}
Area: ${row.area} · priority ${row.priority} · phase ${row.phase}
Issue: ${row.issue}
Review anchor: ${reviewFile}#${row.id.toLowerCase()}
Backlog row: docs/backlog.md

Acceptance criteria — the evidence table must have one row per id:

${criteriaBlock(criteria)}

The review section, which is the specification:

<specification>
${specification}
</specification>

If Out of scope declines an identifier that Scope or an AC requires, add an
\`AC override:\` line that names the identifier and the AC it serves — otherwise
the driver rejects the plan before implementation.

Write the plan with the plan tool, or as your final message if the tool is unavailable. Do not edit files.`;
}

export function executePrompt(input: {
  row: Row;
  plan: string;
  reviewFile: string;
  summaryPath: string;
  criteria: AcceptanceCriterion[];
  skillPath: string;
}): string {
  const { row, plan, reviewFile, summaryPath, criteria, skillPath } = input;
  return `Read ${skillPath} and follow it for this item.

Item: ${row.id} — ${row.title}
Review anchor: ${reviewFile}#${row.id.toLowerCase()}

Acceptance criteria:

${criteriaBlock(criteria)}

${NO_COMMIT}
${NO_GATE}

Follow this plan:

<plan>
${plan}
</plan>

Before you finish, write your summary to ${summaryPath} (create the file): files changed grouped by purpose, one line per acceptance-criterion id saying what satisfies it, and anything you could not do. The driver reads that file for the commit message and PR body.`;
}

export type ReviewFinding = {
  criterion: string;
  status: string;
  evidence: string;
};

export function fixPrompt(input: {
  row: Row;
  plan: string;
  reviewFile: string;
  failedGate: string | null;
  gateOutput: string;
  gaps: string[];
  /** Partial/missing AC rows from the last review, with evidence paths. */
  findings: ReviewFinding[];
  summaryPath: string;
  criteria: AcceptanceCriterion[];
  skillPath: string;
}): string {
  const {
    row,
    plan,
    reviewFile,
    failedGate,
    gateOutput,
    gaps,
    findings,
    summaryPath,
    criteria,
    skillPath,
  } = input;
  const gate =
    failedGate === null
      ? "The gate passed, but an independent review found the work incomplete."
      : `The gate failed at: ${failedGate}`;
  const gapList = gaps.length === 0 ? "(the reviewer reported no gaps)" : gaps.map((gap) => `- ${gap}`).join("\n");
  const findingList =
    findings.length === 0
      ? "(no partial/missing AC rows)"
      : findings
          .map((f) => `- ${f.criterion} (${f.status}): ${f.evidence || "(no evidence path)"}`)
          .join("\n");
  return `Read ${skillPath} and follow it. You are fixing ${row.id}; the previous attempt did not pass.

Review anchor: ${reviewFile}#${row.id.toLowerCase()}

${gate}

<failure>
${gateOutput}
</failure>

<review-gaps>
${gapList}
</review-gaps>

<review-findings>
${findingList}
</review-findings>

Acceptance criteria:

${criteriaBlock(criteria)}

${NO_COMMIT}
${NO_GATE}

<plan>
${plan}
</plan>

Fix the causes. Do not work around the checks, and do not edit a test to match broken behaviour.

Your summary in ${summaryPath} must map every gap and every partial/missing finding to a concrete file change (one line each: \`gap → path\`). If a gap is already fixed, say so with the path that proves it. Do not finish with an unmapped gap.`;
}

export function reviewPrompt(input: {
  row: Row;
  specification: string;
  criteria: AcceptanceCriterion[];
  base: string;
  stat: string;
  changed: string;
  diff: string;
  /** Prior attempt's verdict; when set, verify its gaps before raising new ones. */
  priorVerdict: {
    gaps: string[];
    criteria: ReviewFinding[];
  } | null;
}): string {
  const { row, specification, criteria, base, stat, changed, diff, priorVerdict } = input;
  const priorBlock =
    priorVerdict === null
      ? ""
      : `

This is a fix-round review. A prior attempt already failed with these gaps and partial/missing criteria:

<prior-gaps>
${priorVerdict.gaps.length === 0 ? "(none)" : priorVerdict.gaps.map((g) => `- ${g}`).join("\n")}
</prior-gaps>

<prior-findings>
${
  priorVerdict.criteria
    .filter((c) => c.status === "partial" || c.status === "missing")
    .map((c) => `- ${c.criterion} (${c.status}): ${c.evidence || "(no evidence)"}`)
    .join("\n") || "(none)"
}
</prior-findings>

First verify each prior gap/finding is closed with evidence. Only add a *new* gap when it blocks an acceptance criterion. Do not re-litigate closed ACs or raise preference/style gaps that do not block an AC.
`;

  return `You are an adversarial reviewer with fresh context. Assume nothing the implementer wrote; check the repository itself. The working directory is the repo root.

This session is read-only: shell commands are rejected, so you cannot run the suite. The driver has already run the gate and it passed. Judge from the diff, the code, and the tests.

You are not planning work: do not create a plan and do not call any plan tool. Answer in your final message, and make that message the JSON verdict described at the end.

Item: ${row.id} — ${row.title}
Change: uncommitted work in the working tree, on top of ${base}.
${priorBlock}
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

Acceptance criteria — key every verdict entry by its id. A missing id fails the review:

${criteriaBlock(criteria)}

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
{"satisfied": true, "criteria": [{"criterion": "AC1", "status": "met|partial|missing", "evidence": "path:line or test name"}], "gaps": ["..."], "notes": "one paragraph"}`;
}
