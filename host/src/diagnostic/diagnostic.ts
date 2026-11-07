import type { Span } from "../reader/span.ts";
import { catalogueHelp } from "./helps.ts";

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticCategory =
  | "syntax"
  | "casing"
  | "type"
  | "semantic"
  | "interpreter";

export type DiagnosticNote = {
  message: string;
  span?: Span;
};

export type Diagnostic = {
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  /** Stable id, e.g. E_PARSE_UNCLOSED */
  code: string;
  /** One-line, deterministic, no paths/addresses */
  message: string;
  span: Span;
  notes?: DiagnosticNote[];
  /** Actionable fix hint; omitted from JSON when absent. Printed as `help: …`. */
  help?: string;
};

export function diagnostic(partial: Diagnostic): Diagnostic {
  return {
    ...partial,
    help: partial.help ?? catalogueHelp(partial.code),
  };
}

export function parseErrorToDiagnostic(
  error: { span: Span; message: string; help?: string },
  code = "E_PARSE",
): Diagnostic {
  return diagnostic({
    severity: "error",
    category: "syntax",
    code,
    message: error.message,
    span: error.span,
    help: error.help,
  });
}

export function casingErrorToDiagnostic(
  error: { span: Span; message: string },
): Diagnostic {
  return diagnostic({
    severity: "error",
    category: "casing",
    code: "E_CASING",
    message: error.message,
    span: error.span,
  });
}
