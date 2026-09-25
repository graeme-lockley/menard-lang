import type { Diagnostic } from "./diagnostic.ts";
import {
  buildLineMap,
  lineBytes,
  offsetToLineCol,
  type LineMap,
} from "./line-map.ts";
import type { Span } from "../reader/span.ts";

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

function pushStr(out: number[], s: string): void {
  const b = enc.encode(s);
  for (let i = 0; i < b.length; i++) out.push(b[i]!);
}

function pushBytes(out: number[], b: Uint8Array): void {
  for (let i = 0; i < b.length; i++) out.push(b[i]!);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function gutterWidth(line: number): number {
  return String(line).length;
}

function formatSnippet(
  out: number[],
  source: Uint8Array,
  map: LineMap,
  span: Span,
  gutter: number,
): void {
  const start = offsetToLineCol(map, span.start);
  const endOff = Math.max(span.start, span.end);
  const end = offsetToLineCol(map, endOff === span.start ? span.start : endOff - 1);
  const lineNo = start.line;
  const line = lineBytes(source, map, lineNo);
  const gw = Math.max(gutter, gutterWidth(lineNo));

  pushStr(out, "  |\n");
  pushStr(out, `${padLeft(String(lineNo), gw)} | `);
  pushBytes(out, line);
  pushStr(out, "\n");
  pushStr(out, `${" ".repeat(gw)} | `);

  // underline within this line only (Phase 1: single-line primary)
  const colStart = start.col;
  let colEnd = end.line === start.line ? end.col + (endOff > span.start ? 1 : 0) : line.length + 1;
  if (colEnd <= colStart) colEnd = colStart + 1;
  const underlineLen = Math.max(1, Math.min(colEnd, line.length + 1) - colStart);
  pushStr(out, " ".repeat(Math.max(0, colStart - 1)));
  pushStr(out, "^".repeat(underlineLen));
  pushStr(out, "\n");
}

/**
 * Format a diagnostic to stable text (byte-compared in negative fixtures).
 *
 * path:line:col: error[CODE]: message
 *   |
 * N |   source line
 *   |      ^^^^
 *   = note: ...
 */
export function formatDiagnostic(
  diag: Diagnostic,
  source: Uint8Array | string,
  path = "<input>",
): string {
  const src = typeof source === "string" ? enc.encode(source) : source;
  const map = buildLineMap(src);
  const loc = offsetToLineCol(map, diag.span.start);
  const out: number[] = [];

  pushStr(
    out,
    `${path}:${loc.line}:${loc.col}: ${diag.severity}[${diag.code}]: ${diag.message}\n`,
  );

  const gw = gutterWidth(loc.line);
  formatSnippet(out, src, map, diag.span, gw);

  if (diag.notes) {
    for (const note of diag.notes) {
      pushStr(out, `  = note: ${note.message}\n`);
      if (note.span) {
        const nLoc = offsetToLineCol(map, note.span.start);
        formatSnippet(out, src, map, note.span, Math.max(gw, gutterWidth(nLoc.line)));
      }
    }
  }

  return dec.decode(Uint8Array.from(out));
}

export function formatDiagnostics(
  diags: Diagnostic[],
  source: Uint8Array | string,
  path = "<input>",
): string {
  return diags.map((d) => formatDiagnostic(d, source, path)).join("");
}
