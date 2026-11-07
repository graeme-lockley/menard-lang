/**
 * Comment-aware emitter: leading trivia at indent, then the reader printer.
 * Twin of src/fmt/emit.mnd.
 */
import type { Ast } from "../reader/ast.ts";
import { printAllWithLeading } from "../reader/print.ts";
import type { AttachedTrivia } from "./attach.ts";
import type { TriviaItem } from "./trivia.ts";

/**
 * Drop blank runs at the edges of a trivia group. Inter-form blank lines are
 * owned by the printer's form-sep policy; only blanks *between* comments (or
 * shebang and a following comment) are preserved.
 */
export function trimEdgeBlanks(items: TriviaItem[]): TriviaItem[] {
  let i = 0;
  while (i < items.length && items[i]!.kind === "blank") i++;
  let j = items.length;
  while (j > i && items[j - 1]!.kind === "blank") j--;
  return items.slice(i, j);
}

/** Render leading trivia at `ind` spaces. Comment text bytes are preserved. */
export function formatTriviaItems(items: TriviaItem[], ind: number): string {
  const pad = " ".repeat(ind);
  let out = "";
  for (const item of trimEdgeBlanks(items)) {
    if (item.kind === "shebang") {
      out += item.text + "\n";
      continue;
    }
    if (item.kind === "comment") {
      out += pad + item.text + "\n";
      continue;
    }
    // blank: one extra newline per blank line (separates prior content).
    const n = item.blankLines ?? 1;
    out += "\n".repeat(n);
  }
  return out;
}

export function emitSource(forms: Ast[], attached: AttachedTrivia): Uint8Array {
  const lookup = (ast: Ast, ind: number): string => {
    const items = attached.leading.get(ast.span.start);
    if (!items || items.length === 0) return "";
    return formatTriviaItems(items, ind);
  };
  const trailing =
    attached.trailing.length > 0 ? formatTriviaItems(attached.trailing, 0) : "";
  return printAllWithLeading(forms, lookup, trailing);
}
