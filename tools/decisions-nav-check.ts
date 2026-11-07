#!/usr/bin/env bun
/**
 * Check that docs/decisions.md keeps its DOC-08 navigation layer honest:
 * Current rules, Topic index, per-entry status/supersession, and a single
 * chronological journal file.
 *
 * Run: `bun run tools/decisions-nav-check.ts`, or `make decisions-nav-check`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DECISIONS = "docs/decisions.md";
const AREAS = [
  "representation/GC",
  "syntax",
  "modules",
  "types",
  "tooling",
  "concurrency",
  "FFI",
  "docs",
] as const;

const DATED_HEADING = /^## (\d{4}-\d{2}-\d{2}) — (.+)$/;
const ANCHOR = /^<a id="([^"]+)" name="([^"]+)"><\/a>\s*$/;
const STATUS =
  /^\*\*Status:\*\* (current|open|superseded by \[(\d{4}-\d{2}-\d{2}) — ([^\]]+)\]\(#([^)]+)\))$/;
const MD_LINK = /\[([^\]]+)\]\(#([^)]+)\)/g;

const errors: string[] = [];
const push = (msg: string) => errors.push(msg);

const norm = (s: string) => s.toLowerCase().replace(/[`'"]/g, "").replace(/\s+/g, " ").trim();

/** True when Status:superseded is justified by the superseder's amend scope. */
function supersessionMatchesScope(supersededTitle: string, supersederTitle: string): boolean {
  const amends = supersederTitle.match(/\(amends ([^)]+)\)/i);
  if (!amends) {
    // No amend clause: treat as a full replacement claim (title overlap not required).
    return true;
  }
  const scope = norm(amends[1]!.replace(/^the\s+/i, "").replace(/\s+decision$/i, ""));
  const parenBits = [...supersededTitle.matchAll(/\(([^)]+)\)/g)].map((m) => norm(m[1]!));
  if (parenBits.some((p) => p.includes(scope) || scope.includes(p))) return true;

  const core = supersededTitle.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const topics = core
    .split(/,\s*|\s+and\s+/i)
    .map((t) => norm(t))
    .filter(Boolean);
  if (topics.length === 0) return false;
  // Single-topic: title and amend scope name the same decision.
  if (topics.length === 1) {
    const t = topics[0]!;
    return t === scope || scope.includes(t) || t.includes(scope);
  }
  // Multi-topic entries may only be fully superseded when every topic is in scope.
  return topics.every((t) => scope.includes(t) || t.includes(scope));
}

if (!existsSync(DECISIONS)) {
  console.error(`decisions-nav-check: missing ${DECISIONS}`);
  process.exit(1);
}

const text = readFileSync(DECISIONS, "utf8");
const lines = text.split("\n");

const anchors = new Map<string, number>();
for (let i = 0; i < lines.length; i++) {
  const m = lines[i]!.match(ANCHOR);
  if (!m) continue;
  const id = m[1]!;
  const name = m[2]!;
  if (id !== name) push(`anchor id/name mismatch at line ${i + 1}: id=${id} name=${name}`);
  if (anchors.has(id)) push(`duplicate anchor id "${id}" at line ${i + 1}`);
  anchors.set(id, i + 1);
}

type Dated = {
  line: number;
  date: string;
  title: string;
  id: string;
  statusLine: number;
  statusKind: "current" | "open" | "superseded" | "bad" | "missing";
  supersederId: string | null;
  supersederTitle: string | null;
};
const dated: Dated[] = [];
const byId = new Map<string, Dated>();

for (let i = 0; i < lines.length; i++) {
  const m = lines[i]!.match(DATED_HEADING);
  if (!m) continue;
  const date = m[1]!;
  const title = m[2]!;
  let id = "";
  for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
    const a = lines[j]!.match(ANCHOR);
    if (a) {
      id = a[1]!;
      break;
    }
    if (lines[j]!.trim() !== "") break;
  }
  if (!id) push(`dated entry at line ${i + 1} has no preceding <a id=…> anchor`);

  let statusLine = -1;
  let statusKind: Dated["statusKind"] = "missing";
  let supersederId: string | null = null;
  let supersederTitle: string | null = null;
  for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
    if (lines[j]!.startsWith("**Status:**")) {
      statusLine = j;
      break;
    }
    if (lines[j]!.startsWith("## ") || lines[j]!.startsWith("### ")) break;
  }
  if (statusLine < 0) push(`dated entry at line ${i + 1} has no **Status:** line`);
  else {
    const sm = lines[statusLine]!.match(STATUS);
    if (!sm) {
      statusKind = "bad";
      push(`dated entry at line ${i + 1}: bad status line: ${lines[statusLine]}`);
    } else if (sm[1] === "current") {
      statusKind = "current";
    } else if (sm[1] === "open") {
      statusKind = "open";
    } else if (sm[1]!.startsWith("superseded by")) {
      statusKind = "superseded";
      supersederId = sm[4]!;
      supersederTitle = sm[3]!;
      if (!anchors.has(supersederId)) {
        push(`superseded link #${supersederId} from line ${statusLine + 1} does not resolve`);
      } else if (!supersessionMatchesScope(title, supersederTitle)) {
        push(
          `dated entry #${id} ("${title}") marked fully superseded by "${supersederTitle}", but supersession scope does not cover the whole entry — use Status:current and an **Open:** note for partial amendments`,
        );
      }
    }
  }

  const entry: Dated = {
    line: i + 1,
    date,
    title,
    id,
    statusLine,
    statusKind,
    supersederId,
    supersederTitle,
  };
  dated.push(entry);
  if (id) byId.set(id, entry);
}

if (dated.length === 0) push("no dated ## YYYY-MM-DD entries found");

const firstDatedIdx = lines.findIndex((l) => DATED_HEADING.test(l));
const currentRulesIdx = lines.findIndex((l) => l === "## Current rules");
const topicIndexIdx = lines.findIndex((l) => l === "## Topic index");

if (currentRulesIdx < 0) push("missing ## Current rules heading");
if (topicIndexIdx < 0) push("missing ## Topic index heading");
if (currentRulesIdx >= 0 && topicIndexIdx >= 0) {
  if (!(currentRulesIdx < topicIndexIdx)) push("Current rules must appear before Topic index");
  if (firstDatedIdx >= 0 && !(topicIndexIdx < firstDatedIdx)) {
    push("Current rules and Topic index must appear before the first dated entry");
  }
}

const currentRulesEnd = topicIndexIdx >= 0 ? topicIndexIdx : lines.length;
const topicIndexEnd = firstDatedIdx >= 0 ? firstDatedIdx : lines.length;

if (currentRulesIdx >= 0) {
  const tableAreas: string[] = [];
  for (let i = currentRulesIdx + 1; i < currentRulesEnd; i++) {
    const row = lines[i]!;
    if (!row.startsWith("| ") || row.startsWith("| Area ") || row.startsWith("| ---")) continue;
    const cells = row.split("|").map((c) => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (cells.length < 2) continue;
    const area = cells[0]!;
    const link = cells[1]!;
    tableAreas.push(area);
    const lm = link.match(/^\[[^\]]+\]\(#([^)]+)\)$/);
    if (!lm) push(`Current rules row for "${area}" has no fragment link: ${link}`);
    else {
      const target = lm[1]!;
      if (!anchors.has(target)) push(`Current rules #${target} does not resolve`);
      const entry = byId.get(target);
      if (!entry) push(`Current rules #${target} has no matching dated entry`);
      else if (entry.statusKind !== "current") {
        push(
          `Current rules area "${area}" links to #${target} with Status:${entry.statusKind} (must be current)`,
        );
      }
    }
  }
  if (tableAreas.length !== AREAS.length) {
    push(`Current rules must have exactly ${AREAS.length} area rows, found ${tableAreas.length}`);
  }
  for (let i = 0; i < AREAS.length; i++) {
    if (tableAreas[i] !== AREAS[i]) {
      push(`Current rules area #${i + 1}: expected "${AREAS[i]}", got "${tableAreas[i] ?? "(missing)"}"`);
    }
  }
}

const indexedIds = new Set<string>();
const indexedByArea = new Map<string, string[]>();

if (topicIndexIdx >= 0) {
  let area: string | null = null;
  for (let i = topicIndexIdx + 1; i < topicIndexEnd; i++) {
    const line = lines[i]!;
    const hm = line.match(/^### (.+)$/);
    if (hm) {
      area = hm[1]!;
      if (!AREAS.includes(area as (typeof AREAS)[number])) {
        push(`Topic index unknown area heading: ${area}`);
      }
      if (!indexedByArea.has(area)) indexedByArea.set(area, []);
      continue;
    }
    const bm = line.match(/^- \[(\d{4}-\d{2}-\d{2}) — (.+)\]\(#([^)]+)\)$/);
    if (!bm) continue;
    if (!area) {
      push(`Topic index bullet before any area heading at line ${i + 1}`);
      continue;
    }
    const id = bm[3]!;
    indexedByArea.get(area)!.push(id);
    if (indexedIds.has(id)) push(`Topic index lists #${id} more than once (primary must be unique)`);
    indexedIds.add(id);
    if (!anchors.has(id)) push(`Topic index #${id} does not resolve`);
    const entry = dated.find((d) => d.id === id);
    if (!entry) push(`Topic index #${id} has no matching dated entry`);
    else if (entry.date !== bm[1] || entry.title !== bm[2]) {
      push(`Topic index #${id} label mismatch: got "${bm[1]} — ${bm[2]}", entry is "${entry.date} — ${entry.title}"`);
    }
  }
  for (const a of AREAS) {
    if (!indexedByArea.has(a)) push(`Topic index missing area heading: ${a}`);
  }
}

for (const d of dated) {
  if (!d.id) continue;
  if (!indexedIds.has(d.id)) push(`dated entry #${d.id} missing from Topic index`);
}

// AC6: single decisions journal under docs/ (no decisions-*.md sibling split)
const docsDir = "docs";
const extra = readdirSync(docsDir).filter(
  (name) =>
    name !== "decisions.md" &&
    /^decisions(-.+)?\.md$/i.test(name),
);
for (const name of extra) {
  push(`extra decisions journal file docs/${name} (AC6: do not split the chronology)`);
}
if (existsSync(join(docsDir, "decisions"))) {
  push("docs/decisions/ directory present (AC6: do not split the chronology)");
}

// All fragment links in Current rules + Topic index already checked; also
// verify every #d-… link in those sections resolves (catch typos in prose).
for (let i = Math.max(0, currentRulesIdx); i < topicIndexEnd; i++) {
  const line = lines[i]!;
  for (const m of line.matchAll(MD_LINK)) {
    const target = m[2]!;
    if (!anchors.has(target)) push(`nav section link #${target} at line ${i + 1} does not resolve`);
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`decisions-nav: ${e}`);
  console.error(`\ndecisions-nav-check failed: ${errors.length} error(s)`);
  process.exit(1);
}

console.log(
  `decisions-nav-check ok: ${dated.length} dated entries, ${AREAS.length} areas, ${anchors.size} anchors`,
);
