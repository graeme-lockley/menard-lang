#!/usr/bin/env bun
/**
 * What is safe to start now?
 *
 * `docs/backlog.md` is the status table. A row is safe to start only when
 * every item named in its `Blocked by` cell is `done` (or `wontfix`); a row
 * with one blocker left is the queue behind it. This prints both for the
 * current phase — the lowest phase that still has an open item.
 *
 * Run: `make next`, or `bun run tools/next.ts`.
 * `make next ARGS=--all` ignores the phase gate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Row = {
  id: string;
  title: string;
  area: string;
  priority: string;
  phase: number;
  status: string;
  blockers: string[];
  issue: string;
};

export type Report = {
  rows: Row[];
  currentPhase: number | null;
  allPhases: boolean;
  done: number;
  startNow: Row[];
  inProgress: { row: Row; unmet: string[] }[];
  oneAway: { row: Row; blocker: string }[];
  cycles: string[][];
};

const BACKLOG = join(import.meta.dir, "..", "docs", "backlog.md");
const BLOCKER = /\b(?:LANG|LIB|CONC|TOOL|DOC|OTH)-\d+\b/g;
const SATISFIED = new Set(["done", "wontfix"]);

export function isSatisfied(row: Row): boolean {
  return SATISFIED.has(row.status);
}

export function parseBacklog(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("| [")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 10) continue;
    const id = cells[1]!.match(/\[((?:LANG|LIB|CONC|TOOL|DOC|OTH)-\d+)\]/)?.[1];
    if (id === undefined) continue;
    const issue = cells[8]!.match(/#(\d+)/)?.[1];
    rows.push({
      id,
      title: cells[2]!,
      area: cells[3]!,
      priority: cells[4]!,
      phase: Number(cells[5]),
      status: cells[6]!,
      blockers: cells[7] === "—" ? [] : (cells[7]!.match(BLOCKER) ?? []),
      issue: issue === undefined ? "" : `#${issue}`,
    });
  }
  return rows;
}

/**
 * Strongly connected components bigger than one node: every member blocks
 * every other, so none can ever reach "all blockers done". Only open rows
 * take part; a done row terminates a path.
 */
function findCycles(rows: Row[]): string[][] {
  const openIds = new Set(rows.filter((row) => !isSatisfied(row)).map((row) => row.id));
  const adj = new Map<string, string[]>();
  for (const row of rows) {
    if (openIds.has(row.id)) adj.set(row.id, row.blockers.filter((blocker) => openIds.has(blocker)));
  }

  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adj.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }

    if (low.get(node) !== index.get(node)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    const selfLoop = component.length === 1 && (adj.get(node) ?? []).includes(node);
    if (component.length > 1 || selfLoop) cycles.push(component.sort());
  };

  for (const id of openIds) if (!index.has(id)) visit(id);
  return cycles.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

export function buildReport(rows: Row[], opts: { allPhases?: boolean } = {}): Report {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const open = rows.filter((row) => !isSatisfied(row));
  const currentPhase = open.length === 0 ? null : Math.min(...open.map((row) => row.phase));
  const unmet = (row: Row): string[] =>
    row.blockers.filter((blocker) => {
      const dep = byId.get(blocker);
      return dep === undefined || !isSatisfied(dep);
    });
  const inPhase = (row: Row): boolean => opts.allPhases === true || row.phase === currentPhase;
  const order = (a: Row, b: Row): number =>
    a.phase - b.phase ||
    Number(a.priority.slice(1)) - Number(b.priority.slice(1)) ||
    a.id.localeCompare(b.id);
  const queued = (row: Row): boolean => row.status !== "in-progress" && row.status !== "review";

  const cycles = findCycles(rows);
  const stuck = new Set(cycles.flat());

  return {
    rows,
    currentPhase,
    allPhases: opts.allPhases === true,
    done: rows.filter(isSatisfied).length,
    startNow: open.filter((row) => inPhase(row) && queued(row) && unmet(row).length === 0).sort(order),
    inProgress: open
      .filter((row) => row.status === "in-progress")
      .sort(order)
      .map((row) => ({ row, unmet: unmet(row) })),
    oneAway: open
      .filter((row) => inPhase(row) && queued(row) && unmet(row).length === 1 && !stuck.has(unmet(row)[0]!))
      .sort(order)
      .map((row) => ({ row, blocker: unmet(row)[0]! })),
    cycles,
  };
}

export function formatReport(report: Report, opts: { color?: boolean } = {}): string {
  const bold = (text: string): string => (opts.color === true ? `\x1b[1m${text}\x1b[0m` : text);
  const dim = (text: string): string => (opts.color === true ? `\x1b[2m${text}\x1b[0m` : text);
  const total = report.rows.length;
  if (report.currentPhase === null) return bold(`Backlog complete — ${total} items, all done.`);

  const phaseRows = report.rows.filter((row) => row.phase === report.currentPhase);
  const phaseDone = phaseRows.filter(isSatisfied).length;
  const scope = report.allPhases ? "every phase" : `phase ${report.currentPhase}`;
  const counts = report.allPhases
    ? `${report.done}/${total} done · ${report.startNow.length} ready to start`
    : `${phaseDone}/${phaseRows.length} done in phase ${report.currentPhase} · ${report.done}/${total} overall · ${report.startNow.length} ready to start`;

  const item = (row: Row): string =>
    `  ${row.id.padEnd(8)} ${row.priority.padEnd(3)} ${row.status.padEnd(12)} ${row.title}${row.issue === "" ? "" : `  (${row.issue})`}`;

  const lines: string[] = [bold(`Menard backlog — ${scope}`), dim(counts), ""];

  lines.push(bold("Start now — every blocker is done"));
  if (report.startNow.length === 0) {
    lines.push(dim("  none — nothing in scope is both open and fully unblocked"));
  } else {
    for (const row of report.startNow) lines.push(item(row));
  }

  if (report.inProgress.length > 0) {
    lines.push("", bold("In progress"));
    for (const { row, unmet } of report.inProgress) {
      lines.push(item(row));
      if (unmet.length > 0) lines.push(dim(`    still waiting on ${unmet.join(", ")} for the remaining slice`));
    }
  }

  if (report.oneAway.length > 0) {
    lines.push("", bold("One blocker away"));
    for (const { row, blocker } of report.oneAway) lines.push(`${item(row)}  ${dim(`after ${blocker}`)}`);
  }

  if (report.cycles.length > 0) {
    lines.push("", bold("Dependency cycles — these can never satisfy every blocker"));
    for (const cycle of report.cycles) lines.push(`  ${cycle.join(" ↔ ")}`);
    lines.push(dim("  fix the Blocked by column in docs/backlog.md; make backlog-check does not see cycles"));
  }

  if (!report.allPhases) lines.push("", dim("Ignore the phase gate: make next ARGS=--all"));
  return lines.join("\n");
}

function main(): void {
  const rows = parseBacklog(readFileSync(BACKLOG, "utf8"));
  const report = buildReport(rows, { allPhases: process.argv.includes("--all") });
  const color = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
  console.log(formatReport(report, { color }));
}

if (import.meta.main) main();
