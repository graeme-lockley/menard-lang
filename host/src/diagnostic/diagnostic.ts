import type { Span } from "../reader/span.ts";

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
};

export function diagnostic( partial: Diagnostic): Diagnostic {
  return partial;
}

export function parseErrorToDiagnostic(
  error: { span: Span; message: string },
  code = "E_PARSE",
): Diagnostic {
  return {
    severity: "error",
    category: "syntax",
    code,
    message: error.message,
    span: error.span,
  };
}

export function casingErrorToDiagnostic(
  error: { span: Span; message: string },
): Diagnostic {
  return {
    severity: "error",
    category: "casing",
    code: "E_CASING",
    message: error.message,
    span: error.span,
  };
}
