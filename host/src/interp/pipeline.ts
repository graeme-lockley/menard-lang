import type { Diagnostic } from "../diagnostic/diagnostic.ts";
import {
  parseErrorToDiagnostic,
  casingErrorToDiagnostic,
} from "../diagnostic/diagnostic.ts";
import { formatDiagnostics } from "../diagnostic/format.ts";
import { readAll, checkCasingAll } from "../reader/index.ts";
import { desugarAll } from "../desugar/index.ts";
import { typecheckForms } from "../type/index.ts";
import { evalProgram, type EvalResult } from "../interp/eval.ts";
import { showValue, type Value } from "../interp/index.ts";
import { createHost, type Host } from "../host/index.ts";
import type { Span } from "../reader/span.ts";

export type PipelineOpts = {
  path?: string;
  host?: Host;
  /** Skip typechecking (not for production; tests only) */
  skipTypecheck?: boolean;
};

export type RunOk = { ok: true; value: Value };
export type RunErr = { ok: false; kind: "diagnostics"; diagnostics: Diagnostic[] };
export type RunPanic = {
  ok: false;
  kind: "panic";
  message: string;
  span?: Span;
};
export type RunResult = RunOk | RunErr | RunPanic;

const enc = new TextEncoder();

function toBytes(source: Uint8Array | string): Uint8Array {
  return typeof source === "string" ? enc.encode(source) : source;
}

/**
 * Diagnose source: parse → casing → desugar → type.
 * Fail-fast per phase. Never throws for user programs.
 */
export function diagnose(
  source: Uint8Array | string,
  _opts: PipelineOpts = {},
): Diagnostic[] {
  const src = toBytes(source);

  const parsed = readAll(src);
  if (!parsed.ok) {
    return [parseErrorToDiagnostic(parsed.error, codeForParse(parsed.error.message))];
  }

  const casing = checkCasingAll(parsed.forms);
  if (!casing.ok) {
    return [casingErrorToDiagnostic(casing.error)];
  }

  const desugared = desugarAll(parsed.forms);
  if (!desugared.ok) {
    return desugared.diagnostics;
  }

  if (_opts.skipTypecheck) return [];

  const typed = typecheckForms(desugared.forms);
  return typed.diagnostics;
}

function codeForParse(message: string): string {
  if (message.includes("unclosed")) return "E_PARSE_UNCLOSED";
  if (message.includes("'!'")) return "E_PARSE_BANG";
  if (message.includes("unterminated")) return "E_PARSE_STRING";
  return "E_PARSE";
}

/**
 * Run source: diagnose first; on clean, evaluate.
 */
export function run(
  source: Uint8Array | string,
  opts: PipelineOpts = {},
): RunResult {
  const src = toBytes(source);
  const diags = diagnose(src, opts);
  if (diags.length > 0) {
    return { ok: false, kind: "diagnostics", diagnostics: diags };
  }

  const parsed = readAll(src);
  if (!parsed.ok) {
    return {
      ok: false,
      kind: "diagnostics",
      diagnostics: [parseErrorToDiagnostic(parsed.error)],
    };
  }
  const desugared = desugarAll(parsed.forms);
  if (!desugared.ok) {
    return { ok: false, kind: "diagnostics", diagnostics: desugared.diagnostics };
  }

  const host = opts.host ?? createHost();
  const result: EvalResult = evalProgram(desugared.forms, host);
  if (!result.ok) {
    return {
      ok: false,
      kind: "panic",
      message: result.panic.message,
      span: result.panic.span,
    };
  }
  return { ok: true, value: result.value };
}

export function formatRunErrors(
  result: RunErr | RunPanic,
  source: Uint8Array | string,
  path = "<input>",
): string {
  if (result.kind === "diagnostics") {
    return formatDiagnostics(result.diagnostics, source, path);
  }
  const span = result.span ?? { start: 0, end: 0 };
  return formatDiagnostics(
    [
      {
        severity: "error",
        category: "semantic",
        code: "E_PANIC",
        message: result.message,
        span,
      },
    ],
    source,
    path,
  );
}

export { showValue, formatDiagnostics };
