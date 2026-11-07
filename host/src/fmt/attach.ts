/**
 * Attach trivia items to AST nodes by source span order.
 * Twin of src/fmt/attach.mnd.
 */
import type { Ast } from "../reader/ast.ts";
import type { TriviaItem } from "./trivia.ts";

export type AttachedTrivia = {
  /** Leading trivia keyed by the node's `span.start`. */
  leading: Map<number, TriviaItem[]>;
  /** Trivia after the last attach point. */
  trailing: TriviaItem[];
};

function head(a: Ast): string | null {
  if (a.tag !== "list" || a.kind !== "paren" || a.elems.length === 0) return null;
  const h = a.elems[0]!;
  return h.tag === "sym" ? Buffer.from(h.name).toString("utf8") : null;
}

/**
 * Collect layout attach points in source order: top-level forms, block
 * statements, match/cond arm patterns, and variant constructors.
 */
export function collectAttachPoints(forms: Ast[]): Ast[] {
  const out: Ast[] = [];
  for (const f of forms) walkForm(f, out);
  out.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
  return out;
}

function walkForm(a: Ast, out: Ast[]): void {
  out.push(a);
  if (a.tag !== "list" || a.kind !== "paren") return;
  const h = head(a);
  if (h === "pub" && a.elems[1]) {
    // Walk the inner decl for nested points; the pub wrapper is the attach point.
    walkInner(a.elems[1]!, out, false);
    return;
  }
  walkInner(a, out, false);
}

function walkInner(a: Ast, out: Ast[], asAttach: boolean): void {
  if (asAttach) out.push(a);
  if (a.tag !== "list") return;
  const h = head(a);

  if (h === "defn" || h === "test") {
    // Body is the last element(s) after -> type.
    for (let i = 1; i < a.elems.length; i++) walkExpr(a.elems[i]!, out);
    return;
  }
  if (h === "defrec" || h === "alias" || h === "import" || h === "extern" || h === "runtime") {
    return;
  }
  if (h === "variant") {
    for (let i = 2; i < a.elems.length; i++) out.push(a.elems[i]!);
    return;
  }
  if (h === "do") {
    for (let i = 1; i < a.elems.length; i++) {
      out.push(a.elems[i]!);
      walkStmt(a.elems[i]!, out);
    }
    return;
  }
  walkExpr(a, out);
}

function walkStmt(a: Ast, out: Ast[]): void {
  const h = head(a);
  if (h === "let" || h === "defn") {
    walkInner(a, out, false);
    return;
  }
  if (h === "return" || h === "defer") {
    if (a.tag === "list" && a.elems[1]) walkExpr(a.elems[1]!, out);
    return;
  }
  walkExpr(a, out);
}

function walkExpr(a: Ast, out: Ast[]): void {
  if (a.tag !== "list") return;
  const h = head(a);
  if (h === "do") {
    walkInner(a, out, false);
    return;
  }
  if (h === "match" || h === "mmatch") {
    if (a.elems[1]) walkExpr(a.elems[1]!, out);
    for (let i = 2; i + 1 < a.elems.length; i += 2) {
      out.push(a.elems[i]!); // pattern / arm head
      walkExpr(a.elems[i + 1]!, out);
    }
    return;
  }
  if (h === "cond") {
    for (let i = 1; i < a.elems.length; i++) {
      const c = a.elems[i]!;
      out.push(c);
      if (c.tag === "list") {
        for (let j = 1; j < c.elems.length; j++) walkExpr(c.elems[j]!, out);
      }
    }
    return;
  }
  if (h === "if") {
    for (let i = 1; i < a.elems.length; i++) walkExpr(a.elems[i]!, out);
    return;
  }
  if (h === "fn" || h === "loop" || h === "while" || h === "when") {
    for (let i = 1; i < a.elems.length; i++) walkExpr(a.elems[i]!, out);
    return;
  }
  if (h === "let") {
    for (let i = 1; i < a.elems.length; i++) walkExpr(a.elems[i]!, out);
    return;
  }
  // Generic: walk children for nested layout forms.
  for (let i = 1; i < a.elems.length; i++) {
    const e = a.elems[i]!;
    if (e.tag === "list") walkExpr(e, out);
  }
}

/**
 * Attach each trivia item as leading on the next attach point whose
 * `span.start >= item.end`. Leftover items become file trailing.
 */
export function attachTrivia(items: TriviaItem[], forms: Ast[]): AttachedTrivia {
  const points = collectAttachPoints(forms);
  const leading = new Map<number, TriviaItem[]>();
  const trailing: TriviaItem[] = [];
  let pi = 0;

  for (const item of items) {
    while (pi < points.length && points[pi]!.span.start < item.end) pi++;
    if (pi >= points.length) {
      trailing.push(item);
      continue;
    }
    const key = points[pi]!.span.start;
    const bucket = leading.get(key);
    if (bucket) bucket.push(item);
    else leading.set(key, [item]);
  }

  return { leading, trailing };
}
