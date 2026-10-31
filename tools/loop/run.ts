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
 * The gate is the driver's, not the agent's. It runs once per distinct tree
 * state, clears ~/.menard only on the first attempt, and adds the fixed point
 * when the diff touches the compiler or the runtime.
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
import { extractReviewSection, git, Journal, readState, run, runStreaming, slug, tail, writeState } from "./lib.ts";
import type { State } from "./lib.ts";
import { executePrompt, fixPrompt, planPrompt, reviewPrompt } from "./prompts.ts";

const ROOT = join(import.meta.dir, "..", "..");
const BACKLOG = join(ROOT, "docs", "backlog.md");
const REVIEW = join(ROOT, "docs", "reviews", "2026-10-24-build-f.md");
const STATE = join(ROOT, ".loop", "state.json");
const REVIEW_FILE = "docs/reviews/2026-10-24-build-f.md";
const GATE_STAMP = "gate.stamp.json";
const CACHE_MARKER = "cache-cleared";
const DIFF_LIMIT = 24000;

type Options = {
  dryRun: boolean;
  resume: boolean;
  item: string | null;
  base: string;
  review: boolean;
  fixedPoint: boolean | null;
  cold: boolean;
  allowStaleBase: boolean;
  maxRounds: number;
  model: string | null;
};

type GateStep = { label: string; command: string; args: string[] };
type GateResult = { ok: boolean; failed: string | null; output: string; skipped: boolean; fixedPoint: boolean };
type GateStamp = { tree: string; signature: string; at: string };

type Criterion = { criterion: string; status: string; evidence: string };
type Verdict = { satisfied: boolean; criteria: Criterion[]; gaps: string[]; notes: string };

const timings: { stage: string; ms: number }[] = [];
let currentJournal: Journal | null = null;
let currentState: State | null = null;

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
    fixedPoint: null,
    cold: false,
    allowStaleBase: false,
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
      case "--no-fixed-point":
        options.fixedPoint = false;
        break;
      case "--cold":
        options.cold = true;
        break;
      case "--allow-stale-base":
        options.allowStaleBase = true;
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
  --fixed-point      force 'make check-fixed-point' into the gate
  --no-fixed-point   never run 'make check-fixed-point'
  --cold             clear ~/.menard before the gate (the first attempt does this anyway)
  --allow-stale-base accept a base that is behind origin (default: refuse)
  --model NAME       pass --model to cursor-agent
`);
}

/** The gate is the loop's own sequence, in order, with no shortcuts between steps. */
function gateSteps(fixedPoint: boolean): GateStep[] {
  const steps: GateStep[] = [
    { label: "make", command: "make", args: [] },
    { label: "make ci", command: "make", args: ["ci"] },
    { label: "./mn test", command: "./mn", args: ["test"] },
  ];
  if (fixedPoint) steps.push({ label: "make check-fixed-point", command: "make", args: ["check-fixed-point"] });
  return steps;
}

function gateSignature(steps: GateStep[]): string {
  return steps.map((step) => step.label).join(" | ");
}

/** Stage everything (the driver commits all of it anyway) and hash the tree. */
function treeHash(): string {
  git(["add", "-A"], { cwd: ROOT });
  return git(["write-tree"], { cwd: ROOT });
}

/** A change under src/ or runtime/ has to keep the fixed point green. */
function touchesCompiler(base: string): boolean {
  const changed = run("git", ["diff", "--cached", "--name-only", base], { cwd: ROOT });
  if (changed.code !== 0) return false;
  return changed.stdout
    .split("\n")
    .some((path) => path.startsWith("src/") || path.startsWith("runtime/"));
}

/** Prefer origin/main: a stale local main silently branches from old history. */
function resolveBase(base: string): string {
  if (base !== "main") return base;
  return run("git", ["rev-parse", "--verify", "--quiet", "origin/main"], { cwd: ROOT }).code === 0 ? "origin/main" : "main";
}

/** A base behind its upstream drags old history into the PR. */
function checkBaseFresh(base: string, allowStale: boolean, strict: boolean): string | null {
  if (base.startsWith("origin/")) return null;
  if (run("git", ["rev-parse", "--verify", "--quiet", `origin/${base}`], { cwd: ROOT }).code !== 0) return null;
  const behind = Number(run("git", ["rev-list", "--count", `${base}..origin/${base}`], { cwd: ROOT }).stdout.trim());
  if (!Number.isFinite(behind) || behind === 0) return null;
  const message = `base ${base} is ${behind} commit(s) behind origin/${base}`;
  if (!allowStale && strict) die(`${message} — update it, or pass --allow-stale-base`);
  return message;
}

/** The blob hash of this file: the console says which harness is running. */
function driverId(): string {
  const blob = run("git", ["hash-object", "tools/loop/run.ts"], { cwd: ROOT }).stdout.trim();
  return blob === "" ? "unknown" : blob.slice(0, 8);
}

function hasPlanSections(text: string): boolean {
  return text.includes("## Scope") && text.includes("## Steps");
}

function readStamp(journal: Journal): GateStamp | null {
  const raw = journal.read(GATE_STAMP);
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== "object" || data === null) return null;
    const record = data as Record<string, unknown>;
    if (typeof record["tree"] !== "string" || typeof record["signature"] !== "string") return null;
    return { tree: record["tree"], signature: record["signature"], at: String(record["at"] ?? "") };
  } catch {
    return null;
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

async function timed<T>(stage: string, action: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await action();
  } finally {
    timings.push({ stage, ms: Date.now() - started });
  }
}

function printTimeline(journal: Journal): void {
  if (timings.length === 0) return;
  journal.banner("summary");
  const width = Math.max(...timings.map((entry) => entry.stage.length), 5);
  for (const entry of timings) journal.mark(`${entry.stage.padEnd(width)}  ${formatDuration(entry.ms)}`);
  const total = timings.reduce((sum, entry) => sum + entry.ms, 0);
  journal.mark(`${"total".padEnd(width)}  ${formatDuration(total)}`);
}

async function runGate(
  journal: Journal,
  options: Options,
  state: State,
  attempt: number,
): Promise<GateResult> {
  // Stage first: touchesCompiler() reads the index, and the index only reflects
  // the worktree after `git add -A`.
  const tree = options.dryRun ? "" : treeHash();
  const fixedPoint = options.fixedPoint ?? (options.dryRun ? false : touchesCompiler(state.base));
  const steps = gateSteps(fixedPoint);

  if (options.dryRun) {
    if (options.cold) journal.mark("$ rm -rf ~/.menard (cold gate)");
    for (const step of steps) journal.mark(`$ ${step.command} ${step.args.join(" ")}`.trimEnd());
    return { ok: true, failed: null, output: "", skipped: false, fixedPoint };
  }

  const signature = gateSignature(steps);
  const stamp = readStamp(journal);
  if (stamp !== null && stamp.tree === tree && stamp.signature === signature) {
    journal.mark(`gate already green for tree ${tree.slice(0, 8)} — skipped`);
    return { ok: true, failed: null, output: "", skipped: true, fixedPoint };
  }

  // A cold cache proves the build from nothing, but only once per run: a fix
  // round does not need to recompile the compiler to test the fix.
  if (options.cold || !existsSync(journal.path(CACHE_MARKER))) {
    journal.mark("$ rm -rf ~/.menard (cold gate)");
    const cleared = run("rm", ["-rf", join(homedir(), ".menard")], { cwd: ROOT });
    if (cleared.code !== 0) {
      return { ok: false, failed: "rm -rf ~/.menard", output: tail(cleared.stderr), skipped: false, fixedPoint };
    }
    journal.save(CACHE_MARKER, new Date().toISOString());
  } else {
    journal.mark("cache warm: ~/.menard kept (pass --cold for a cold gate)");
  }

  for (const step of steps) {
    journal.mark(`$ ${step.command} ${step.args.join(" ")}`.trimEnd());
    const started = Date.now();
    const result = await runStreaming(step.command, step.args, { cwd: ROOT, echo: true });
    const output = `${result.stdout}\n${result.stderr}`;
    journal.save(`gate-${attempt}-${slug(step.label, 4)}.log`, `${output}\n# exit ${result.code}${result.timedOut ? " (timed out)" : ""}`);
    if (result.timedOut) {
      return { ok: false, failed: `${step.label} (timed out)`, output: tail(output), skipped: false, fixedPoint };
    }
    if (result.code !== 0) {
      journal.mark(`  FAILED: ${step.label}`);
      return { ok: false, failed: step.label, output: tail(output), skipped: false, fixedPoint };
    }
    journal.mark(`  ok in ${formatDuration(Date.now() - started)}`);
  }

  journal.save(GATE_STAMP, JSON.stringify({ tree, signature, at: new Date().toISOString() }));
  return { ok: true, failed: null, output: "", skipped: false, fixedPoint };
}

/** Commands the agent must leave to the driver, because it is about to run them. */
const FULL_GATE_COMMANDS = [
  /\bmake\s+(test|ci|check-fixed-point|bootstrap)\b/,
  /(?:^|[;&|]\s*)(?:\.\/)?mn\s+test\s*(?:$|[;&|])/,
];

/** Scan the raw event stream for full-gate commands the agent ran anyway. */
export function auditAgentCommands(events: string): string[] {
  const found: string[] = [];
  for (const line of events.split("\n")) {
    if (!line.includes('"tool_call"')) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event["type"] !== "tool_call" || event["subtype"] !== "started") continue;
    const toolCall = event["tool_call"];
    if (typeof toolCall !== "object" || toolCall === null) continue;
    const record = toolCall as Record<string, unknown>;
    const key = Object.keys(record).find((name) => name.endsWith("ToolCall"));
    if (key === undefined) continue;
    const call = record[key];
    if (typeof call !== "object" || call === null) continue;
    const args = (call as Record<string, unknown>)["args"];
    if (typeof args !== "object" || args === null) continue;
    const command = (args as Record<string, unknown>)["command"];
    if (typeof command !== "string") continue;
    if (FULL_GATE_COMMANDS.some((pattern) => pattern.test(command))) found.push(command.split("\n")[0] ?? command);
  }
  return found;
}

export type CursorTrace = { result: string | null; text: string; plan: string | null };
export type AgentReply = { text: string; plan: string | null };

/** The plan payload from a createPlanToolCall event, if there is one. */
export function planFromToolCall(toolCall: unknown): string | null {
  if (typeof toolCall !== "object" || toolCall === null) return null;
  const record = toolCall as Record<string, unknown>;
  const call = record["createPlanToolCall"];
  if (typeof call !== "object" || call === null) return null;
  const args = (call as Record<string, unknown>)["args"];
  if (typeof args !== "object" || args === null) return null;
  const plan = (args as Record<string, unknown>)["plan"];
  return typeof plan === "string" && plan.trim() !== "" ? plan : null;
}

/** The part of a Journal the renderer needs, so it can be tested without one. */
type Log = { log(message: string): void };

const TOOL_LABELS: Record<string, string> = {
  readToolCall: "read",
  editToolCall: "edit",
  shellToolCall: "shell",
  grepToolCall: "grep",
  globToolCall: "glob",
  listDirToolCall: "ls",
  updateTodosToolCall: "todos",
  getMcpToolsToolCall: "mcp",
  awaitToolCall: "await",
  createPlanToolCall: "plan",
  deleteFileToolCall: "rm",
};

function toolDetail(args: unknown): string {
  if (typeof args !== "object" || args === null) return "";
  const record = args as Record<string, unknown>;
  for (const key of ["command", "path", "pattern", "query", "globPattern"]) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value.replace(/\s+/g, " ").trim();
  }
  return "";
}

/** `shell: make typecheck`, `read: stdlib/actor.mnd`, `edit: tests/actor/call-death.mnd`. */
export function describeToolCall(toolCall: unknown, root = ""): string {
  if (typeof toolCall !== "object" || toolCall === null) return "tool";
  const record = toolCall as Record<string, unknown>;
  const key = Object.keys(record).find((name) => name.endsWith("ToolCall"));
  if (key === undefined) return "tool";
  const label = TOOL_LABELS[key] ?? key.replace(/ToolCall$/, "").replace(/([A-Z])/g, " $1").toLowerCase().trim();
  const call = record[key];
  const args = typeof call === "object" && call !== null ? (call as Record<string, unknown>)["args"] : undefined;
  const detail = toolDetail(args);
  if (detail === "") return label;
  const shown = root !== "" && detail.startsWith(`${root}/`) ? detail.slice(root.length + 1) : detail;
  return `${label}: ${shown.length > 140 ? `${shown.slice(0, 140)}…` : shown}`;
}

/** The text blocks of an assistant event. */
function assistantText(event: Record<string, unknown>): string {
  const message = event["message"];
  if (typeof message !== "object" || message === null) return "";
  const content = (message as Record<string, unknown>)["content"];
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const record = part as Record<string, unknown>;
    if (record["type"] === "text" && typeof record["text"] === "string") parts.push(record["text"]);
  }
  return parts.join("");
}

/**
 * Render one NDJSON event from `cursor-agent --output-format stream-json`.
 * Anything that is not an event (a warning, a stray line) is printed as-is.
 */
export function renderCursorEvent(line: string, log: Log, trace: CursorTrace): void {
  const trimmed = line.trim();
  if (trimmed === "") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    log.log(trimmed);
    return;
  }
  if (typeof parsed !== "object" || parsed === null) {
    log.log(trimmed);
    return;
  }
  const event = parsed as Record<string, unknown>;
  const type = typeof event["type"] === "string" ? event["type"] : "";
  switch (type) {
    case "system": {
      if (event["subtype"] !== "init") return;
      const model = typeof event["model"] === "string" ? event["model"] : "unknown";
      log.log(`  [cursor] model ${model}`);
      return;
    }
    case "assistant": {
      const text = assistantText(event);
      if (text.trim() === "") return;
      trace.text += text;
      log.log(text.trimEnd());
      return;
    }
    case "tool_call": {
      if (event["subtype"] !== "started") return;
      const plan = planFromToolCall(event["tool_call"]);
      if (plan !== null) trace.plan = plan;
      log.log(`  → ${describeToolCall(event["tool_call"], ROOT)}`);
      return;
    }
    case "thinking":
      return;
    case "retry":
    case "connection": {
      const subtype = typeof event["subtype"] === "string" ? `: ${event["subtype"]}` : "";
      log.log(`  ! ${type}${subtype}`);
      return;
    }
    case "result": {
      if (typeof event["result"] === "string") trace.result = event["result"];
      const duration = typeof event["duration_ms"] === "number" ? Math.round(event["duration_ms"] / 1000) : null;
      log.log(`  ← ${typeof event["subtype"] === "string" ? event["subtype"] : "done"}${duration === null ? "" : ` in ${duration}s`}`);
      return;
    }
    default:
      return;
  }
}

async function askCursor(
  prompt: string,
  mode: "plan" | "ask" | "write",
  journal: Journal,
  options: Options,
  timeoutMinutes: number,
  label: string,
): Promise<AgentReply> {
  const args = ["-p", "--output-format", "stream-json", "--trust", "--workspace", ROOT];
  if (options.model !== null) args.push("--model", options.model);
  if (mode === "plan") args.push("--plan");
  else if (mode === "ask") args.push("--mode", "ask");
  else args.push("--force");
  args.push(prompt);

  const flag = mode === "plan" ? "--plan" : mode === "ask" ? "--mode ask" : "--force";
  journal.mark(`$ cursor-agent -p ${flag} <${prompt.length} char prompt>`);
  if (options.dryRun) return { text: "(dry run: cursor-agent not invoked)", plan: null };

  const trace: CursorTrace = { result: null, text: "", plan: null };
  let lastEvent = Date.now();
  const heartbeat = setInterval(() => {
    const idle = Math.round((Date.now() - lastEvent) / 1000);
    if (idle >= 20) journal.mark(`  … still running (${Math.floor(idle / 60)}m${String(idle % 60).padStart(2, "0")}s)`);
  }, 20_000);

  const result = await (async () => {
    try {
      return await runStreaming("cursor-agent", args, {
        cwd: ROOT,
        timeoutMs: timeoutMinutes * 60_000,
        onLine: (line) => {
          lastEvent = Date.now();
          renderCursorEvent(line, journal, trace);
        },
      });
    } finally {
      clearInterval(heartbeat);
    }
  })();

  journal.save(
    `cursor-${label}.log`,
    `# exit ${result.code}${result.timedOut ? " (timed out)" : ""}\n\n# events\n${result.stdout}\n\n# stderr\n${result.stderr}`,
  );
  const wasted = auditAgentCommands(result.stdout);
  if (wasted.length > 0) {
    journal.mark(`  ! agent ran the full gate ${wasted.length}× (the driver runs it after this step): ${wasted.join(" · ")}`);
  }

  if (result.timedOut) {
    throw new Error(`cursor-agent (${mode}) timed out after ${timeoutMinutes} minutes; see ${journal.path("run.log")}`);
  }
  if (result.code !== 0) {
    throw new Error(`cursor-agent (${mode}) exited ${result.code}:\n${tail(result.stderr || result.stdout, 4000)}`);
  }
  const text = trace.result ?? trace.text;
  if (text.trim() === "" && (trace.plan ?? "").trim() === "") {
    throw new Error(`cursor-agent (${mode}) returned no text; see ${journal.path(`cursor-${label}.log`)}`);
  }
  return { text, plan: trace.plan };
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

async function runReview(
  journal: Journal,
  options: Options,
  row: Row,
  specification: string,
  state: State,
  attempt: number,
): Promise<Verdict> {
  if (!options.review) return { satisfied: true, criteria: [], gaps: [], notes: "(review disabled)" };
  if (options.dryRun) {
    journal.mark("$ cursor-agent -p --mode ask <review prompt>");
    return { satisfied: true, criteria: [], gaps: [], notes: "(dry run)" };
  }

  const stat = run("git", ["diff", "--cached", "--stat", state.base], { cwd: ROOT }).stdout.trim();
  const changed = run("git", ["diff", "--cached", "--name-only", state.base], { cwd: ROOT }).stdout.trim();
  const rawDiff = run("git", ["diff", "--cached", state.base], { cwd: ROOT }).stdout;
  const diff = rawDiff.length > DIFF_LIMIT ? `${rawDiff.slice(0, DIFF_LIMIT)}\n… truncated at ${DIFF_LIMIT} characters` : rawDiff;

  const reply = await askCursor(
    reviewPrompt({ row, specification, base: state.base, stat, changed, diff }),
    "ask",
    journal,
    options,
    20,
    `review-${attempt}`,
  );
  journal.save(`review-${attempt}.raw.md`, reply.plan ?? reply.text);

  // The verdict can arrive as the final message, in a plan payload, or not at
  // all (plan mode used to write it into a plan document). Harvest, then ask
  // once, cheaply, for the JSON only.
  let verdict = parseVerdict(reply.text) ?? (reply.plan === null ? null : parseVerdict(reply.plan));
  if (verdict === null) {
    const notes = [reply.text, reply.plan ?? ""].filter((part) => part.trim() !== "").join("\n\n");
    journal.mark("! no JSON verdict in the review reply — asking it to format one");
    const formatted = await askCursor(
      `Convert the review notes below into exactly this JSON object, with no other text:\n{"satisfied": boolean, "criteria": [{"criterion": "...", "status": "met|partial|missing", "evidence": "path:line or test name"}], "gaps": ["..."], "notes": "one paragraph"}\n\n<notes>\n${notes}\n</notes>`,
      "ask",
      journal,
      options,
      5,
      `review-${attempt}-format`,
    );
    verdict = parseVerdict(formatted.text) ?? (formatted.plan === null ? null : parseVerdict(formatted.plan));
  }
  if (verdict === null) {
    throw new Error(
      `reviewer produced no JSON verdict after a formatting retry; artifacts in ${journal.dir}. Commit the green tree without a verdict with: make loop ARGS="--resume --no-review"`,
    );
  }
  journal.save(`review-${attempt}.json`, JSON.stringify(verdict, null, 2));
  journal.save("review.json", JSON.stringify(verdict, null, 2));
  for (const criterion of verdict.criteria) journal.mark(`  ${criterion.status.padEnd(8)} ${criterion.criterion}`);
  for (const gap of verdict.gaps) journal.mark(`  gap: ${gap}`);
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

/** The backlog stores "#22"; accept either form and never print "##22". */
export function issueRef(row: Row): string {
  if (row.issue === "") return "";
  return row.issue.startsWith("#") ? row.issue : `#${row.issue}`;
}

function commitSubject(row: Row): string {
  return `${commitType(row.area)}(${commitScope(row.area)}): ${lowerFirst(cleanTitle(row))} (${row.id})`;
}

function commitBody(row: Row, summary: string): string {
  const explanation = summary.trim();
  const bounded = explanation.length > 1600 ? `${explanation.slice(0, 1600).trimEnd()}\n…` : explanation;
  const closes = row.issue === "" ? "" : `\nCloses ${issueRef(row)}`;
  return `Implements ${row.id} from the Build F review: ${cleanTitle(row)}.\n\n${bounded}\n\nItem: ${row.id}${closes}`;
}

function pullRequestBody(row: Row, summary: string, verdict: Verdict, options: Options, fixedPoint: boolean): string {
  const checks = [
    "- [x] `make` (cold `~/.menard` on the first attempt)",
    "- [x] `make ci`",
    "- [x] `./mn test`",
    ...(fixedPoint ? ["- [x] `make check-fixed-point`"] : []),
    "- [x] `make backlog-check`",
    "- [x] Interpreter and native build agree on the new behaviour",
    "- [x] No acceptance criterion is left unticked",
    "- [x] `docs/backlog.md` is updated in this PR",
  ];
  const review = options.review
    ? `- [x] Independent review pass: every acceptance criterion met (${verdict.criteria.length} checked)`
    : "- [ ] Independent review pass: skipped (`--no-review`)";
  const notes = verdict.notes.trim() === "" ? "None." : verdict.notes.trim();
  const closes = row.issue === "" ? "—" : issueRef(row);
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  process.chdir(ROOT);
  options.base = resolveBase(options.base);
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
  currentJournal = journal;
  currentState = options.dryRun ? null : state;

  const saveState = (patch: Partial<State> = {}): void => {
    state = { ...state, ...patch };
    currentState = state;
    if (!options.dryRun) writeState(STATE, state);
  };

  journal.mark(`Menard loop — ${row.id}: ${cleanTitle(row)}`);
  journal.mark(`driver ${driverId()} · base ${state.base}${options.dryRun ? " (dry run)" : ""}`);
  const baseWarning = checkBaseFresh(state.base, options.allowStaleBase, !options.dryRun);
  if (baseWarning !== null) journal.mark(`! ${baseWarning}`);
  if (resuming && state.lastError !== undefined) journal.mark(`previous failure: ${state.lastError}`);

  const specification = extractReviewSection(readFileSync(REVIEW, "utf8"), row.id);
  if (specification === null) die(`could not find ${row.id} in ${REVIEW}`);

  if (!resuming && !options.dryRun) {
    journal.banner(`select ${row.id}`);
    journal.mark(`${row.id} — ${cleanTitle(row)} (${row.area}, ${row.priority}, ${issueRef(row)})`);
    journal.banner(`branch ${state.branch}`);
    git(["switch", "-c", state.branch, state.base], { cwd: ROOT });
    saveState({ phase: "plan" });
  }

  let plan = journal.read("plan.md");
  if (plan === null) {
    journal.banner("plan");
    const first = await timed("plan", () =>
      askCursor(planPrompt({ row, specification, reviewFile: REVIEW_FILE }), "plan", journal, options, 20, "plan"),
    );
    let captured = first.plan ?? first.text;
    if (!options.dryRun && !hasPlanSections(captured)) {
      journal.mark("! captured plan is missing ## Scope / ## Steps — asking once more");
      const retry = await timed("plan retry", () =>
        askCursor(
          `${planPrompt({ row, specification, reviewFile: REVIEW_FILE })}\n\nYour previous reply was not a plan with the required sections. Return the plan itself, with its headings, as your final message.`,
          "plan",
          journal,
          options,
          20,
          "plan-retry",
        ),
      );
      const retried = retry.plan ?? retry.text;
      if (hasPlanSections(retried)) captured = retried;
    }
    if (!options.dryRun && !hasPlanSections(captured)) {
      journal.mark("! plan still lacks ## Scope / ## Steps; continuing with what was captured");
    }
    plan = captured;
    journal.save("plan.md", plan);
  }

  const agentSummaryPath = journal.path("agent-summary.md");
  const readAgentSummary = (fallback: string): string => {
    if (!existsSync(agentSummaryPath)) return fallback;
    const written = readFileSync(agentSummaryPath, "utf8").trim();
    return written === "" ? fallback : written;
  };

  let summary = journal.read("summary.md");
  if (summary === null) {
    journal.banner("implement");
    rmSync(agentSummaryPath, { force: true });
    const reply = await timed("implement", () =>
      askCursor(executePrompt({ row, plan, reviewFile: REVIEW_FILE, summaryPath: agentSummaryPath }), "write", journal, options, 90, "implement"),
    );
    summary = readAgentSummary(reply.text);
    journal.save("summary.md", summary);
    saveState({ phase: "gate" });
  }

  const skipGate = state.phase === "commit" || state.phase === "pr";
  let round = state.rounds;
  let lastGate: GateResult = { ok: true, failed: null, output: "", skipped: false, fixedPoint: options.fixedPoint === true };

  if (skipGate) {
    journal.mark("resuming after the gate: commit and PR only");
  } else {
    while (true) {
      const attempt = round + 1;
      journal.banner(`gate + review (attempt ${attempt})`);
      const gate = await timed(`gate ${attempt}`, () => runGate(journal, options, state, attempt));
      lastGate = gate;
      const verdict = gate.ok
        ? await timed(`review ${attempt}`, () => runReview(journal, options, row, specification, state, attempt))
        : null;
      if (gate.ok && (verdict === null || verdict.satisfied)) break;

      if (round >= options.maxRounds) {
        saveState({ phase: "gate", rounds: round });
        throw new Error(
          `not green after ${attempt} attempt(s). Artifacts: ${journal.dir}/gate-*.log, review.json. Fix by hand, then rerun with --resume.`,
        );
      }

      journal.banner(`fix (attempt ${attempt + 1})`);
      rmSync(agentSummaryPath, { force: true });
      const fixReply = await timed(`fix ${attempt}`, () =>
        askCursor(
          fixPrompt({
            row,
            plan,
            reviewFile: REVIEW_FILE,
            failedGate: gate.ok ? null : gate.failed,
            gateOutput: gate.ok ? "" : gate.output,
            gaps: verdict?.gaps ?? [],
            summaryPath: agentSummaryPath,
          }),
          "write",
          journal,
          options,
          60,
          `fix-${attempt}`,
        ),
      );
      journal.save(`fix-${attempt}.md`, readAgentSummary(fixReply.text));
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
  await timed("commit", async () => {
    if (options.dryRun) {
      journal.mark("[dry-run] git add -A");
      journal.mark(`[dry-run] git commit -m ${JSON.stringify(subject)}`);
      return;
    }
    if (run("git", ["status", "--porcelain"], { cwd: ROOT }).stdout.trim() === "") {
      journal.mark("nothing to commit: the work is already committed");
      return;
    }
    git(["add", "-A"], { cwd: ROOT });
    const commit = run("git", ["commit", "-m", subject, "-m", body], { cwd: ROOT });
    if (commit.code !== 0) throw new Error(`git commit failed:\n${commit.stdout}${commit.stderr}`);
    journal.mark(commit.stdout.trim().split("\n")[0] ?? "committed");
  });
  saveState({ phase: "pr" });

  journal.banner("pull request");
  journal.save("pr.md", pullRequestBody(row, summary, parsed, options, lastGate.fixedPoint));
  if (options.dryRun) {
    journal.mark(`[dry-run] git push -u origin ${state.branch}`);
    journal.mark(`[dry-run] gh pr create --base ${state.base} --head ${state.branch} --title ${JSON.stringify(subject)}`);
    printTimeline(journal);
    journal.mark(`done — artifacts in ${journal.dir}`);
    return;
  }

  await timed("pull request", async () => {
    git(["push", "-u", "origin", state.branch], { cwd: ROOT });
    const existing = run("gh", ["pr", "list", "--head", state.branch, "--state", "open", "--json", "url"], { cwd: ROOT });
    if (existing.code !== 0) throw new Error(`gh pr list failed:\n${existing.stderr}`);
    const openPulls = JSON.parse(existing.stdout) as { url: string }[];
    if (openPulls.length > 0) {
      journal.mark(`open PR already exists: ${openPulls[0]?.url ?? ""}`);
      return;
    }
    const created = run(
      "gh",
      ["pr", "create", "--base", state.base, "--head", state.branch, "--title", subject, "--body-file", journal.path("pr.md")],
      { cwd: ROOT },
    );
    if (created.code !== 0) throw new Error(`gh pr create failed:\n${created.stdout}\n${created.stderr}`);
    journal.mark(created.stdout.trim());
  });

  rmSync(STATE, { force: true });
  printTimeline(journal);
  journal.mark(`done — artifacts in ${journal.dir}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (currentJournal !== null) printTimeline(currentJournal);
    process.stderr.write(`\nloop: ${message}\n`);
    if (currentJournal !== null) currentJournal.mark(`FAILED: ${message}`);
    const saved = readState(STATE) ?? currentState;
    if (saved !== null) {
      try {
        writeState(STATE, { ...saved, lastError: message });
      } catch {
        /* the failure is already on screen and in run.log */
      }
    }
    process.exit(1);
  });
}
