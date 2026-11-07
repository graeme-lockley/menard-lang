/**
 * Format a Menard source buffer: CRLF reject → read → attach trivia → emit.
 * Spaces AST binary operators; never rewrites identifier bytes (LANG-09 AC7).
 * Preserves full-line comments, shebangs, and `#source` / `@test` lines (TOOL-01).
 */
import { readAll } from "../reader/read.ts";
import { bytesEqual } from "../reader/ast.ts";
import type { Span } from "../reader/span.ts";
import { scanTrivia } from "./trivia.ts";
import { attachTrivia } from "./attach.ts";
import { emitSource } from "./emit.ts";

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
  const trivia = scanTrivia(source);
  if (!trivia.ok) {
    return { ok: false, message: trivia.message, help: trivia.help };
  }

  const read = readAll(source);
  if (!read.ok) {
    return {
      ok: false,
      message: read.error.message,
      help: read.error.help,
      span: read.error.span,
    };
  }

  const attached = attachTrivia(trivia.items, read.forms);
  const bytes = emitSource(read.forms, attached);
  return { ok: true, bytes, changed: !bytesEqual(source, bytes) };
}
