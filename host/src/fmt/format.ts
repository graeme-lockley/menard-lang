/**
 * Format a Menard source buffer via read → print.
 * Spaces AST binary operators; never rewrites identifier bytes (LANG-09 AC7).
 */
import { readAll } from "../reader/read.ts";
import { printAll } from "../reader/print.ts";
import { bytesEqual } from "../reader/ast.ts";
import type { Span } from "../reader/span.ts";

export type FormatOk = {
  ok: true;
  bytes: Uint8Array;
  changed: boolean;
};

export type FormatErr = {
  ok: false;
  message: string;
  help?: string;
  span?: Span;
};

export type FormatResult = FormatOk | FormatErr;

export function formatSource(source: Uint8Array): FormatResult {
  const read = readAll(source);
  if (!read.ok) {
    return {
      ok: false,
      message: read.error.message,
      help: read.error.help,
      span: read.error.span,
    };
  }
  const bytes = printAll(read.forms);
  return { ok: true, bytes, changed: !bytesEqual(source, bytes) };
}
