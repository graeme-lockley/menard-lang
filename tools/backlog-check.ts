#!/usr/bin/env bun
/**
 * Check that the review and the backlog agree.
 *
 * The review (`docs/reviews/2026-10-24-build-f.md`) is the specification and
 * the acceptance criteria. The backlog (`docs/backlog.md`) is the live status
 * table. Every review item needs exactly one backlog row, and every row must
 * name a real item with a valid status, priority, phase and (for Phase 0) an
 * issue.
 *
 * Run: `bun run tools/backlog-check.ts`, or `make backlog-check`.
 */
import { readFileSync } from "node:fs";

const REVIEW = "docs/reviews/2026-10-24-build-f.md";
const BACKLOG = "docs/backlog.md";
const ID = /^(?:LANG|LIB|CONC|TOOL|DOC|OTH)-\d+$/;
const STATUSES = new Set(["todo", "ready", "in-progress", "blocked", "review", "done", "wontfix"]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);

type Row = {
  id: string;
  status: string;
  priority: string;
  phase: number;
  blocked: string;
  issue: string;
};

const review = readFileSync(REVIEW, "utf8");
const ids: string[] = [];
for (const m of review.matchAll(/^### ((?:LANG|LIB|CONC|TOOL|DOC|OTH)-\d+) — /gm)) {
  ids.push(m[1]!);
}

const lines = readFileSync(BACKLOG, "utf8").split("\n");
const rows: Row[] = [];
const errors: string[] = [];

for (const line of lines) {
  if (!line.startsWith("| [") || line.startsWith("| ID ")) continue;
  const parts = line.split("|");
  if (parts.length < 10) {
    errors.push(`malformed row: ${line.slice(0, 100)}`);
    continue;
  }
  const idMatch = parts[1]!.match(/\[((?:LANG|LIB|CONC|TOOL|DOC|OTH)-\d+)\]/);
  if (!idMatch) {
    errors.push(`row has no item ID: ${line.slice(0, 100)}`);
    continue;
  }
  const id = idMatch[1]!;
  const phase = Number(parts[5]!.trim());
  const row: Row = {
    id,
    status: parts[6]!.trim(),
    priority: parts[4]!.trim(),
    phase,
    blocked: parts[7]!.trim(),
    issue: parts[8]!.trim(),
  };
  rows.push(row);

  if (!ID.test(id)) errors.push(`${id}: invalid ID`);
  if (!STATUSES.has(row.status)) errors.push(`${id}: unknown status "${row.status}"`);
  if (!PRIORITIES.has(row.priority)) errors.push(`${id}: unknown priority "${row.priority}"`);
  if (!Number.isInteger(phase) || phase < 0 || phase > 5) errors.push(`${id}: invalid phase "${parts[5]!.trim()}"`);
  if (row.issue !== "—" && !/^\[#\d+\]\(https:\/\/github\.com\/[^)]+\/issues\/\d+\)$/.test(row.issue)) {
    errors.push(`${id}: issue cell must be — or [#N](https://github.com/.../issues/N)`);
  }
  if (phase === 0 && row.issue === "—") errors.push(`${id}: Phase 0 item has no issue`);
  for (const m of row.blocked.matchAll(/\b((?:LANG|LIB|CONC|TOOL|DOC|OTH)-\d+)\b/g)) {
    if (!ids.includes(m[1]!)) errors.push(`${id}: blocked by unknown item ${m[1]}`);
  }
}

const seen = new Set<string>();
for (const row of rows) {
  if (seen.has(row.id)) errors.push(`${row.id}: duplicate row`);
  seen.add(row.id);
}
for (const id of ids) if (!seen.has(id)) errors.push(`${id}: missing backlog row`);
for (const row of rows) if (!ids.includes(row.id)) errors.push(`${row.id}: row has no review item`);

if (errors.length > 0) {
  for (const e of errors) console.error(`backlog: ${e}`);
  console.error(`\nbacklog-check failed: ${errors.length} error(s)`);
  process.exit(1);
}

const ready = rows.filter((r) => r.status === "ready").length;
const done = rows.filter((r) => r.status === "done").length;
console.log(`backlog ok: ${rows.length} items (${ready} ready, ${done} done) — ${REVIEW}`);
