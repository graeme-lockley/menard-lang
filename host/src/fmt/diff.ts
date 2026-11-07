/**
 * Line-oriented unified diff of original vs formatted source.
 * Twin of src/fmt/diff.mnd.
 */

/**
 * Produce a unified diff (`---` / `+++` / `@@`) comparing `before` to `after`.
 * Paths appear in the headers; both sides are split on `\n` (no CR).
 */
export function unifiedDiff(before: string, after: string, path: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  // Preserve a trailing empty element only when the text ends with `\n`,
  // matching conventional diff line splitting of text files.
  if (a.length > 0 && before.endsWith("\n")) a.pop();
  if (b.length > 0 && after.endsWith("\n")) b.pop();

  const hunks = myersHunks(a, b);
  if (hunks.length === 0) return "";

  const lines: string[] = [`--- ${path}`, `+++ ${path}`];
  for (const h of hunks) {
    lines.push(`@@ -${h.aStart},${h.aCount} +${h.bStart},${h.bCount} @@`);
    for (const row of h.lines) lines.push(row);
  }
  return lines.join("\n") + "\n";
}

type Hunk = {
  aStart: number;
  aCount: number;
  bStart: number;
  bCount: number;
  lines: string[];
};

/** Simple LCS-based hunk builder (fine for source files). */
function myersHunks(a: string[], b: string[]): Hunk[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? 1 + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  type Edit = { kind: "eq" | "del" | "add"; text: string };
  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      edits.push({ kind: "eq", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      edits.push({ kind: "del", text: a[i]! });
      i++;
    } else {
      edits.push({ kind: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    edits.push({ kind: "del", text: a[i]! });
    i++;
  }
  while (j < m) {
    edits.push({ kind: "add", text: b[j]! });
    j++;
  }

  // Group into hunks with 3 lines of context.
  const CONTEXT = 3;
  const changed = edits.map((e) => e.kind !== "eq");
  const hunks: Hunk[] = [];
  let idx = 0;
  let aLine = 1;
  let bLine = 1;
  while (idx < edits.length) {
    while (idx < edits.length && !changed[idx]) {
      aLine++;
      bLine++;
      idx++;
    }
    if (idx >= edits.length) break;

    let start = Math.max(0, idx - CONTEXT);
    let end = idx;
    while (end < edits.length) {
      while (end < edits.length && changed[end]) end++;
      let look = end;
      while (look < edits.length && look < end + 2 * CONTEXT && !changed[look]) look++;
      if (look < edits.length && changed[look] && look - end <= 2 * CONTEXT) {
        end = look;
        continue;
      }
      end = Math.min(edits.length, end + CONTEXT);
      break;
    }

    // Recompute a/b starts from the beginning for this window.
    let aStart = 1;
    let bStart = 1;
    for (let k = 0; k < start; k++) {
      if (edits[k]!.kind !== "add") aStart++;
      if (edits[k]!.kind !== "del") bStart++;
    }

    const lines: string[] = [];
    let aCount = 0;
    let bCount = 0;
    for (let k = start; k < end; k++) {
      const e = edits[k]!;
      if (e.kind === "eq") {
        lines.push(` ${e.text}`);
        aCount++;
        bCount++;
      } else if (e.kind === "del") {
        lines.push(`-${e.text}`);
        aCount++;
      } else {
        lines.push(`+${e.text}`);
        bCount++;
      }
    }
    hunks.push({ aStart, aCount, bStart, bCount, lines });

    for (let k = start; k < end; k++) {
      if (edits[k]!.kind !== "add") aLine++;
      if (edits[k]!.kind !== "del") bLine++;
    }
    // Fix aLine/bLine to end position — actually recompute from end:
    aLine = aStart + aCount;
    bLine = bStart + bCount;
    idx = end;
  }
  return hunks;
}
