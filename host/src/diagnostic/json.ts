import { readFileSync } from "node:fs";
import type { Diagnostic } from "./diagnostic.ts";
import { buildLineMap, offsetToLineCol } from "./line-map.ts";
import type { Span } from "../reader/span.ts";

export const DIAGNOSTICS_VERSION = 1;

export type JsonSpan = {
  start: number;
  end: number;
  line: number;
  column: number;
};

export type JsonDiagnostic = {
  code: string;
  severity: "error" | "warning";
  message: string;
  help?: string;
  path: string;
  span: JsonSpan;
};

export type DiagnosticsDocument = {
  version: number;
  diagnostics: JsonDiagnostic[];
};

export type JsonPanicFrame = {
  path: string;
  span: JsonSpan;
};

export type PanicDocument = {
  kind: "panic";
  message: string;
  path: string;
  span: JsonSpan;
  frames: JsonPanicFrame[];
};

export type PanicFrameLike = { path: string; span: Span };

const enc = new TextEncoder();

function toBytes(source: Uint8Array | string): Uint8Array {
  return typeof source === "string" ? enc.encode(source) : source;
}

export function spanToJson(span: Span, source: Uint8Array | string): JsonSpan {
  const src = toBytes(source);
  const map = buildLineMap(src);
  const loc = offsetToLineCol(map, span.start);
  return {
    start: span.start,
    end: span.end,
    line: loc.line,
    column: loc.col,
  };
}

function spanToJsonFromPath(span: Span, path: string, fallback?: Uint8Array | string): JsonSpan {
  try {
    const src = new Uint8Array(readFileSync(path));
    return spanToJson(span, src);
  } catch {
    if (fallback !== undefined) return spanToJson(span, fallback);
    return { start: span.start, end: span.end, line: 1, column: 1 };
  }
}

export function diagnosticToJson(
  diag: Diagnostic,
  source: Uint8Array | string,
  path: string,
): JsonDiagnostic {
  const out: JsonDiagnostic = {
    code: diag.code,
    severity: diag.severity,
    message: diag.message,
    path,
    span: spanToJson(diag.span, source),
  };
  if (diag.help !== undefined) out.help = diag.help;
  return out;
}

export function diagnosticsToJson(
  diags: Diagnostic[],
  source: Uint8Array | string,
  path: string,
): DiagnosticsDocument {
  return {
    version: DIAGNOSTICS_VERSION,
    diagnostics: diags.map((d) => diagnosticToJson(d, source, path)),
  };
}

/** One JSON object for stdout; no trailing human text. */
export function formatDiagnosticsJson(
  diags: Diagnostic[],
  source: Uint8Array | string,
  path: string,
): string {
  return JSON.stringify(diagnosticsToJson(diags, source, path)) + "\n";
}

export function panicToJson(
  message: string,
  path: string,
  span: Span | undefined,
  frames: PanicFrameLike[],
  source?: Uint8Array | string,
): PanicDocument {
  const spanJson: JsonSpan = span
    ? source !== undefined
      ? spanToJson(span, source)
      : spanToJsonFromPath(span, path)
    : { start: 0, end: 0, line: 1, column: 1 };
  return {
    kind: "panic",
    message,
    path,
    span: spanJson,
    frames: frames.map((f) => ({
      path: f.path,
      span: spanToJsonFromPath(f.span, f.path, source),
    })),
  };
}

/** One JSON panic object for stderr. */
export function formatPanicJson(
  message: string,
  path: string,
  span: Span | undefined,
  frames: PanicFrameLike[],
  source?: Uint8Array | string,
): string {
  return JSON.stringify(panicToJson(message, path, span, frames, source)) + "\n";
}
