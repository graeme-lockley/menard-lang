#!/usr/bin/env bun
/**
 * `make loop` — one pass of the backlog loop, codified.
 *
 * The loop it replaces was: pick the next item, branch, plan with an agent,
 * implement with an agent, prove it is production quality, run the gate,
 * commit, open a PR. Verbatim, that is a checklist a human re-executes from
 * memory, and every step is skippable under pressure.
 *
 * This driver splits the loop in two:
 *
 *   - Judgement (Cursor): the plan, the implementation, the fixes, and the
 *     independent review. The agent never commits, pushes, or opens a PR.
 *   - Invariants (this file): which item is next, the branch, the gate, the
 *     commit shape, the PR. These are code, so they cannot be skipped,
 *     softened, or reordered by the agent that is being graded.
 *
 * Run:  make loop
 *       make loop ARGS="--dry-run"
 *       make loop ARGS="--resume"
 *
 * State and every artifact live in .loop/, which is gitignored.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { buildReport, parseBacklog } from "../next.ts";
import type { Row } from "../next.ts";
import { extractReviewSection, git, Journal, readState, run, slug, tail, writeState } from "./lib.ts";
import type { State } from "./lib.ts";
import { executePrompt, fixPrompt, planPrompt, reviewPrompt } from "./prompts.ts";

const ROOT = join(import.meta.dir, "..", "..");
const BACKLOG = join(ROOT, "docs", "backlog.md");
const REVIEW = join(ROOT, "docs", "reviews", "2026-10-24-build-f.md");
const STATE = join(ROOT, ".loop", "state.json");
const REVIEW_FILE = "docs/reviews/2026-10-24-build-f.md";

type Options = {
  dryRun: boolean;
  resume: boolean;
  item: string | null;
  base: string;
  review: boolean;
  fixedPoint: boolean;
  maxRounds: number;
  model: string | null;
};

type GateStep = { label: string; command: string; args: string[] };
type GateResult = { ok: boolean; failed: string | null; output: string };

type Criterion = { criterion: string; status: string; evidence: string };
type Verdict = { satisfied: boolean; criteria: Criterion[]; gaps: string[]; notes: string };

function die(message: string): never {
  process.stderr.write(`loop: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    dryRun: false,
    resume: false,
    item: null,
    base: "main",
    review: true,
    fixedPoint: false,
    maxRounds: 2,
    model: null,
  };
  const value = (index: number, flag: string): string => {
    const next = argv[index];
    if (next === undefined || next.startsWith("--")) die(`${flag} needs a value`);
    return next;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    switch (arg) {
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--resume":
        options.resume = true;
        break;
      case "--item":
        options.item = value(index + 1, arg).toUpperCase();
        index += 1;
        break;
      case "--base":
        options.base = value(index + 1, arg);
        index += 1;
        break;
      case "--model":
        options.model = value(index + 1, arg);
        index += 1;
        break;
      case "--max-rounds": {
        const rounds = Number(value(index + 1, arg));
        if (!Number.isInteger(rounds) || rounds < 0) die("--max-rounds needs a non-negative integer");
        options.maxRounds = rounds;
        index += 1;
        break;
      }
      case "--no-review":
        options.review = false;
        break;
      case "--fixed-point":
        options.fixedPoint = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        die(`unknown option ${arg} (try --help)`);
    }
  }
  return options;
}

function printHelp(): void {
  process.stdout.write(`Menard backlog loop.

  --item ID          start a specific item instead of the next ready one
  --base REF         branch from REF (default: main)
  --dry-run          print the loop without running agents, git, or the gate
  --resume           continue the run recorded in .loop/state.json
  --max-rounds N     fix attempts after the first implementation (default: 2)
  --no-review        skip the review pass; the gate is then the only judge
  --fixed-point      add 'make check-fixed-point' to the gate (slow)
  --model NAME       pass --model to cursor-agent
`);
}

/** The gate is the loop's own sequence, in order, with no shortcuts between steps. */
function gateSteps(options: Options): GateStep[] {
  const steps: GateStep[] = [
    { label: "rm -rf ~/.menard", command: "rm", args: ["-rf", join(homedir(), ".menard")] },
    { label: "make", command: "make", args: [] },
    { label: "make ci", command: "make", args: ["ci"] },
    { label: "./mn test", command: "./mn", args: ["test"] },
  ];
  if (options.fixedPoint) {
    steps.push({ label: "make check-fixed-point", command: "make", args: ["check-fixed-point"] });
  }
  return steps;
}

function runGate(journal: Journal, options: Options): GateResult {
  for (const step of gateSteps(options)) {
    journal.log(`$ ${step.command} ${step.args.join(" ")}`.trimEnd());
    if (options.dryRun) continue;
    const result = run(step.command, step.args, { cwd: ROOT });
    const output = `${result.stdout}\n${result.stderr}`;
    journal.save(`gate-${slug(step.label, 4)}.log`, `${output}\n# exit ${result.code}${result.timedOut ? " (timed out)" : ""}`);
    if (result.timedOut) return { ok: false, failed: `${step.label} (timed out)`, output: tail(output) };
    if (result.code !== 0) {
      journal.log(`  FAILED: ${step.label}`);
      return { ok: false, failed: step.label, output: tail(output) };
    }
    journal.log("  ok");
  }
  return { ok: true, failed: null, output: "" };
}

/** cursor-agent's JSON envelope, with a text fallback for older builds. */
function unwrapCursor(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return text;
  try {
    const data: unknown = JSON.parse(text);
    const fromRecord = (value: unknown): string | null => {
      if (typeof value !== "object" || value === null) return null;
      const record = value as Record<string, unknown>;
      const result = record["result"];
      if (typeof result === "string" && result !== "") return result;
      const message = record["message"];
      if (typeof message === "string" && message !== "") return message;
      return null;
    };
    if (Array.isArray(data)) {
      for (let index = data.length - 1; index >= 0; index -= 1) {
        const found = fromRecord(data[index]);
        if (found !== null) return found;
      }
      return text;
    }
    return fromRecord(data) ?? text;
  } catch {
    return text;
  }
}

function askCursor(
  prompt: string,
  mode: "plan" | "write",
  journal: Journal,
  options: Options,
  timeoutMinutes: number,
): string {
  const args = ["-p", "--output-format", "json", "--trust", "--workspace", ROOT];
  if (options.model !== null) args.push("--model", options.model);
  args.push(mode === "plan" ? "--plan" : "--force");
  args.push(prompt);

  journal.log(`$ cursor-agent -p ${mode === "plan" ? "--plan" : "--force"} <${prompt.length} char prompt>`);
  if (options.dryRun) return "(dry run: cursor-agent not invoked)";

  const result = run("cursor-agent", args, { cwd: ROOT, timeoutMs: timeoutMinutes * 60_000 });
  journal.save(
    mode === "plan" ? "cursor-plan.log" : "cursor-write.log",
    `# exit ${result.code}${result.timedOut ? " (timed out)" : ""}\n\n# stdout\n${result.stdout}\n\n# stderr\n${result.stderr}`,
  );
  if (result.timedOut) {
    throw new Error(`cursor-agent (${mode}) timed out after ${timeoutMinutes} minutes; see ${journal.path("run.log")}`);
  }
  if (result.code !== 0) {
    throw new Error(`cursor-agent (${mode}) exited ${result.code}:\n${tail(result.stderr || result.stdout, 4000)}`);
  }
  const text = unwrapCursor(result.stdout);
  if (text.trim() === "") throw new Error(`cursor-agent (${mode}) returned no text; see ${journal.path("cursor-plan.log")}`);
  return text;
}

/** Parse the reviewer's verdict, tolerating a stray code fence around it. */
function parseVerdict(raw: string): Verdict | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const satisfied = record["satisfied"];
  if (typeof satisfied !== "boolean") return null;
  const gaps = Array.isArray(record["gaps"])
    ? record["gaps"].filter((gap): gap is string => typeof gap === "string")
    : [];
  const criteria: Criterion[] = [];
  if (Array.isArray(record["criteria"])) {
    for (const entry of record["criteria"]) {
      if (typeof entry !== "object" || entry === null) continue;
      const item = entry as Record<string, unknown>;
      criteria.push({
        criterion: typeof item["criterion"] === "string" ? item["criterion"] : "",
        status: typeof item["status"] === "string" ? item["status"] : "unknown",
        evidence: typeof item["evidence"] === "string" ? item["evidence"] : "",
      });
    }
  }
  return {
    satisfied,
    criteria,
    gaps,
    notes: typeof record["notes"] === "string" ? record["notes"] : "",
  };
}

function runReview(
  journal: Journal,
  options: Options,
  row: Row,
  specification: string,
  state: State,
): Verdict {
  if (!options.review) return { satisfied: true, criteria: [], gaps: [], notes: "(review disabled)" };
  if (options.dryRun) {
    journal.log("$ cursor-agent -p --plan <review prompt>");
    return { satisfied: true, criteria: [], gaps: [], notes: "(dry run)" };
  }

  const status = run("git", ["status", "--porcelain"], { cwd: ROOT }).stdout.trimEnd();
  const stat = run("git", ["diff", "--stat", state.base], { cwd: ROOT }).stdout.trim();
  const raw = askCursor(
    reviewPrompt({ row, specification, base: state.base, status, stat }),
    "plan",
    journal,
    options,
    20,
  );
  journal.save("review.raw.md", raw);
  const verdict = parseVerdict(raw);
  if (verdict === null) {
    throw new Error(`reviewer output was not valid JSON; read ${journal.path("review.raw.md")} and rerun with --resume`);
  }
  journal.save("review.json", JSON.stringify(verdict, null, 2));
  for (const criterion of verdict.criteria) journal.log(`  ${criterion.status.padEnd(8)} ${criterion.criterion}`);
  for (const gap of verdict.gaps) journal.log(`  gap: ${gap}`);
  return verdict;
}

function commitType(area: string): string {
  switch (area) {
    case "Language":
      return "fix";
    case "Libraries":
      return "feat";
    case "Concurrency":
      return "fix";
    case "Tooling":
      return "feat";
    case "Documentation":
      return "docs";
    default:
      return "chore";
  }
}

function commitScope(area: string): string {
  switch (area) {
    case "Language":
      return "lang";
    case "Libraries":
      return "stdlib";
    case "Concurrency":
      return "runtime";
    case "Tooling":
      return "tooling";
    case "Documentation":
      return "docs";
    default:
      return "repo";
  }
}

function cleanTitle(row: Row): string {
  return row.title.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function lowerFirst(text: string): string {
  const first = text.split(" ")[0] ?? "";
  if (!/^[A-Z][a-z]/.test(first)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function commitSubject(row: Row): string {
  return `${commitType(row.area)}(${commitScope(row.area)}): ${lowerFirst(cleanTitle(row))} (${row.id})`;
}

function commitBody(row: Row, summary: string): string {
  const explanation = summary.trim();
  const bounded = explanation.length > 1600 ? `${explanation.slice(0, 1600).trimEnd()}\n…` : explanation;
  const closes = row.issue === "" ? "" : `\nCloses #${row.issue}`;
  return `Implements ${row.id} from the Build F review: ${cleanTitle(row)}.\n\n${bounded}\n\nItem: ${row.id}${closes}`;
}

function pullRequestBody(row: Row, summary: string, verdict: Verdict, options: Options): string {
  const checks = [
    "- [x] `rm -rf ~/.menard && make`",
    "- [x] `make ci`",
    "- [x] `./mn test`",
    ...(options.fixedPoint ? ["- [x] `make check-fixed-point`"] : []),
    "- [x] `make backlog-check`",
    "- [x] Interpreter and native build agree on the new behaviour",
    "- [x] No acceptance criterion is left unticked",
    "- [x] `docs/backlog.md` is updated in this PR",
  ];
  const review = options.review
    ? `- [x] Independent review pass: every acceptance criterion met (${verdict.criteria.length} checked)`
    : "- [ ] Independent review pass: skipped (`--no-review`)";
  const notes = verdict.notes.trim() === "" ? "None." : verdict.notes.trim();
  const closes = row.issue === "" ? "—" : `#${row.issue}`;
  return `## Item

- Item: ${row.id}
- Closes: ${closes}
- Backlog row: updated in this PR

## What changed

${summary.trim()}

## Checks

${[...checks, review].join("\n")}

## Notes

${notes}
`;
}

function requireCleanTree(): void {
  const status = run("git", ["status", "--porcelain"], { cwd: ROOT }).stdout.trimEnd();
  if (status !== "") die(`the working tree is dirty — commit or stash first:\n${status}`);
}

function pickRow(rows: Row[], report: ReturnType<typeof buildReport>, options: Options): Row {
  if (options.item !== null) {
    const match = rows.find((row) => row.id === options.item);
    if (match === undefined) die(`unknown item ${options.item}; see docs/backlog.md`);
    if (match.status === "done" || match.status === "wontfix") die(`${options.item} is already ${match.status}`);
    return match;
  }
  const next = report.startNow.find((row) => row.issue !== "");
  if (next === undefined) die("nothing ready to start has a GitHub issue; run 'make next' to see the queue");
  return next;
}

function branchName(row: Row): string {
  const prefix = row.area === "Documentation" ? "docs" : "fix";
  return `${prefix}/${row.id.toLowerCase()}-${slug(cleanTitle(row), 6)}`;
}

function preflight(options: Options): void {
  for (const command of ["git", "make", "bun"]) {
    if (Bun.which(command) === null) die(`missing required command: ${command}`);
  }
  if (!options.dryRun) {
    for (const command of ["cursor-agent", "gh"]) {
      if (Bun.which(command) === null) die(`missing required command: ${command}`);
    }
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  process.chdir(ROOT);
  preflight(options);

  const rows = parseBacklog(readFileSync(BACKLOG, "utf8"));
  const report = buildReport(rows);

  let state: State;
  let row: Row;
  let resuming = false;

  if (options.resume) {
    const saved = readState(STATE);
    if (saved === null) die("--resume: no .loop/state.json; start a fresh run without --resume");
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT });
    if (branch !== saved.branch) {
      die(`--resume: on branch ${branch}, but the saved run is ${saved.branch}; switch back or start fresh`);
    }
    const match = rows.find((candidate) => candidate.id === saved.item);
    if (match === undefined) die(`--resume: item ${saved.item} is no longer in the backlog`);
    state = saved;
    row = match;
    resuming = true;
  } else {
    if (!options.dryRun && existsSync(STATE)) {
      die("a run is already recorded in .loop/state.json — use --resume, or remove it to start fresh");
    }
    if (!options.dryRun) requireCleanTree();
    row = pickRow(rows, report, options);
    state = {
      item: row.id,
      branch: branchName(row),
      base: options.base,
      phase: "plan",
      rounds: 0,
      startedAt: new Date().toISOString(),
    };
  }

  const artifactDir = join(ROOT, ".loop", options.dryRun ? `${row.id.toLowerCase()}-dry` : row.id.toLowerCase());
  if (options.dryRun) rmSync(artifactDir, { recursive: true, force: true });
  const journal = new Journal(artifactDir);

  const saveState = (patch: Partial<State> = {}): void => {
    state = { ...state, ...patch };
    if (!options.dryRun) writeState(STATE, state);
  };

  journal.log(`Menard loop — ${row.id}: ${cleanTitle(row)}`);
  journal.log(`branch ${state.branch} from ${state.base}${options.dryRun ? " (dry run)" : ""}`);

  const specification = extractReviewSection(readFileSync(REVIEW, "utf8"), row.id);
  if (specification === null) die(`could not find ${row.id} in ${REVIEW}`);

  if (!resuming && !options.dryRun) {
    journal.banner(`select ${row.id}`);
    journal.log(`${row.id} — ${cleanTitle(row)} (${row.area}, ${row.priority}, #${row.issue})`);
    journal.banner(`branch ${state.branch}`);
    git(["switch", "-c", state.branch, state.base], { cwd: ROOT });
    saveState({ phase: "plan" });
  }

  let plan = journal.read("plan.md");
  if (plan === null) {
    journal.banner("plan");
    plan = askCursor(planPrompt({ row, specification, reviewFile: REVIEW_FILE }), "plan", journal, options, 20);
    journal.save("plan.md", plan);
  }

  let summary = journal.read("summary.md");
  if (summary === null) {
    journal.banner("implement");
    summary = askCursor(executePrompt({ row, plan, reviewFile: REVIEW_FILE }), "write", journal, options, 90);
    journal.save("summary.md", summary);
    saveState({ phase: "gate" });
  }

  const skipGate = state.phase === "commit" || state.phase === "pr";
  let round = state.rounds;

  if (skipGate) {
    journal.log("resuming after the gate: commit and PR only");
  } else {
    while (true) {
      journal.banner(`gate + review (attempt ${round + 1})`);
      const gate = runGate(journal, options);
      const verdict = gate.ok ? runReview(journal, options, row, specification, state) : null;
      if (gate.ok && (verdict === null || verdict.satisfied)) break;

      if (round >= options.maxRounds) {
        saveState({ phase: "gate", rounds: round });
        throw new Error(
          `not green after ${round + 1} attempt(s). Artifacts: ${journal.dir}/gate-*.log, review.json. Fix by hand, then rerun with --resume.`,
        );
      }

      journal.banner(`fix (attempt ${round + 2})`);
      const fixSummary = askCursor(
        fixPrompt({
          row,
          plan,
          reviewFile: REVIEW_FILE,
          failedGate: gate.ok ? null : gate.failed,
          gateOutput: gate.ok ? "" : gate.output,
          gaps: verdict?.gaps ?? [],
        }),
        "write",
        journal,
        options,
        60,
      );
      journal.save(`fix-${round + 1}.md`, fixSummary);
      round += 1;
      saveState({ rounds: round, phase: "gate" });
    }

    saveState({ phase: "commit", rounds: round });
  }

  const storedReview = journal.read("review.json");
  const parsed: Verdict = storedReview === null
    ? { satisfied: true, criteria: [], gaps: [], notes: "Review pass disabled." }
    : (JSON.parse(storedReview) as Verdict);

  journal.banner("commit");
  const subject = commitSubject(row);
  const body = commitBody(row, summary);
  if (options.dryRun) {
    journal.log("[dry-run] git add -A");
    journal.log(`[dry-run] git commit -m ${JSON.stringify(subject)}`);
  } else if (run("git", ["status", "--porcelain"], { cwd: ROOT }).stdout.trim() === "") {
    journal.log("nothing to commit: the work is already committed");
  } else {
    git(["add", "-A"], { cwd: ROOT });
    const commit = run("git", ["commit", "-m", subject, "-m", body], { cwd: ROOT });
    if (commit.code !== 0) throw new Error(`git commit failed:\n${commit.stdout}${commit.stderr}`);
    journal.log(commit.stdout.trim());
  }
  saveState({ phase: "pr" });

  journal.banner("pull request");
  journal.save("pr.md", pullRequestBody(row, summary, parsed, options));
  if (options.dryRun) {
    journal.log(`[dry-run] git push -u origin ${state.branch}`);
    journal.log(`[dry-run] gh pr create --base ${state.base} --head ${state.branch} --title ${JSON.stringify(subject)}`);
    journal.log(`[dry-run] done — artifacts in ${journal.dir}`);
    return;
  }

  git(["push", "-u", "origin", state.branch], { cwd: ROOT });
  const existing = run("gh", ["pr", "list", "--head", state.branch, "--state", "open", "--json", "url"], { cwd: ROOT });
  if (existing.code !== 0) throw new Error(`gh pr list failed:\n${existing.stderr}`);
  const openPulls = JSON.parse(existing.stdout) as { url: string }[];
  if (openPulls.length > 0) {
    journal.log(`open PR already exists: ${openPulls[0]?.url ?? ""}`);
  } else {
    const created = run(
      "gh",
      ["pr", "create", "--base", state.base, "--head", state.branch, "--title", subject, "--body-file", journal.path("pr.md")],
      { cwd: ROOT },
    );
    if (created.code !== 0) throw new Error(`gh pr create failed:\n${created.stdout}\n${created.stderr}`);
    journal.log(created.stdout.trim());
  }

  rmSync(STATE, { force: true });
  journal.log(`\nDone. Artifacts: ${journal.dir}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\nloop: ${message}\n`);
    process.exit(1);
  }
}
