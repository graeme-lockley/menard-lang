import type { Ast } from "../reader/ast.ts";
import { nameEquals, symName } from "../reader/ast.ts";
import type { Diagnostic } from "../diagnostic/diagnostic.ts";
import { diagnostic } from "../diagnostic/diagnostic.ts";
import type { Span } from "../reader/span.ts";

/**
 * Rest parameters. `(defn sum (xs: (List Int) ...) -> Int …)` is one list
 * parameter. A call packs its rest arguments into that list:
 * `(sum 1 2)` → `(sum (Cons 1 (Cons 2 (Nil))))`, `(sum)` → `(sum (Nil))`,
 * `(sum ... xs)` → `(sum xs)`, `(sum 1 ... xs)` → `(sum (Cons 1 xs))`.
 * A splice that is not a suffix is appended with a generated
 * `mn-rest-append`. Runs after desugar and before typing.
 * Mirrors src/desugar/rest.mnd.
 */

const dec = new TextDecoder();

export type PackResult = {
  ok: boolean;
  forms: Ast[];
  diagnostics: Diagnostic[];
};

type Piece =
  | { kind: "elem"; expr: Ast }
  | { kind: "splice"; expr: Ast; span: Span };

type Ctx = {
  active: Map<string, number>;
  diags: Diagnostic[];
  appendName: string;
  need: boolean;
  needSpan: Span;
};

function symText(ast: Ast | undefined): string | null {
  if (!ast || ast.tag !== "sym") return null;
  return dec.decode(ast.name);
}

function isSym(ast: Ast, name: string): boolean {
  return ast.tag === "sym" && nameEquals(ast.name, name);
}

function isDots(ast: Ast | undefined): boolean {
  return !!ast && isSym(ast, "...");
}

function sym(name: string, span: Span): Ast {
  return { tag: "sym", name: symName(name), span };
}

function list(kind: "paren" | "bracket", elems: Ast[], span: Span): Ast {
  return { tag: "list", kind, elems, span };
}

function push(diags: Diagnostic[], span: Span, code: string, message: string): void {
  diags.push(
    diagnostic({ severity: "error", category: "type", code, message, span }),
  );
}

function containsDots(ast: Ast): boolean {
  if (isDots(ast)) return true;
  if (ast.tag === "list") return ast.elems.some(containsDots);
  return false;
}

function dotsSpan(ast: Ast): Span {
  if (isDots(ast)) return ast.span;
  if (ast.tag === "list") {
    for (const e of ast.elems) {
      if (containsDots(e)) return dotsSpan(e);
    }
  }
  return ast.span;
}

function nameText(ast: Ast): string | null {
  if (ast.tag === "sym") return symText(ast);
  if (ast.tag === "list" && ast.elems[0]) return symText(ast.elems[0]);
  return null;
}

function unwrapPub(form: Ast): { inner: Ast; exported: boolean } {
  if (
    form.tag === "list" &&
    form.kind === "paren" &&
    form.elems.length >= 2 &&
    isSym(form.elems[0]!, "pub")
  ) {
    return {
      exported: true,
      inner: list(form.kind, form.elems.slice(1), form.span),
    };
  }
  return { inner: form, exported: false };
}

function keywordOf(form: Ast): string | null {
  const inner = unwrapPub(form).inner;
  if (inner.tag !== "list" || inner.elems.length === 0) return null;
  return symText(inner.elems[0]!);
}

function definedName(form: Ast): string | null {
  const kw = keywordOf(form);
  if (kw !== "defn" && kw !== "extern" && kw !== "runtime") return null;
  const inner = unwrapPub(form).inner;
  if (inner.tag !== "list" || !inner.elems[1]) return null;
  return nameText(inner.elems[1]);
}

function paramAsts(form: Ast): Ast[] | null {
  const kw = keywordOf(form);
  if (kw !== "defn" && kw !== "extern" && kw !== "runtime") return null;
  const inner = unwrapPub(form).inner;
  if (inner.tag !== "list") return null;
  const out: Ast[] = [];
  for (let i = 2; i < inner.elems.length; i++) {
    const e = inner.elems[i]!;
    if (isSym(e, "->")) break;
    out.push(e);
  }
  return out;
}

function isListType(ast: Ast): boolean {
  return (
    ast.tag === "list" &&
    ast.kind === "paren" &&
    ast.elems.length >= 2 &&
    isSym(ast.elems[0]!, "List")
  );
}

/** Fixed-argument count of a valid rest `defn`/`extern`, or null. */
function restFixed(form: Ast, diags: Diagnostic[] | null): number | null {
  const params = paramAsts(form);
  if (!params) return null;
  let restAt = -1;
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (!containsDots(p)) continue;
    if (restAt >= 0 || i !== params.length - 1) {
      if (diags) push(diags, dotsSpan(p), "E_TYPE_REST", "rest parameter must be last");
      return null;
    }
    restAt = i;
  }
  if (restAt < 0) return null;
  return validateRestParam(params[restAt]!, restAt, diags);
}

function validateRestParam(p: Ast, index: number, diags: Diagnostic[] | null): number | null {
  const fail = (span: Span, message: string): null => {
    if (diags) push(diags, span, "E_TYPE_REST", message);
    return null;
  };
  if (p.tag !== "list" || p.kind !== "paren" || p.elems.length === 0) {
    return fail(dotsSpan(p), "rest parameter must be a (name: Type ...) form");
  }
  const last = p.elems[p.elems.length - 1]!;
  if (!isDots(last)) {
    return fail(dotsSpan(p), "rest marker must be the last element of the parameter");
  }
  for (let i = 0; i < p.elems.length - 1; i++) {
    if (containsDots(p.elems[i]!)) {
      return fail(dotsSpan(p.elems[i]!), "rest marker must be the last element of the parameter");
    }
  }
  if (p.elems.length !== 3) {
    return fail(p.span, "rest parameter must be a (name: Type ...) form");
  }
  const ty = p.elems[1]!;
  if (!isListType(ty)) {
    return fail(ty.span, "rest parameter type must be a List");
  }
  return index;
}

function declNames(form: Ast): string[] {
  const inner = unwrapPub(form).inner;
  if (inner.tag !== "list" || inner.elems.length < 2) return [];
  const kw = symText(inner.elems[0]!);
  if (kw === "defn" || kw === "extern" || kw === "runtime" || kw === "defrec" || kw === "alias") {
    const n = nameText(inner.elems[1]!);
    return n ? [n] : [];
  }
  if (kw === "let") {
    const n = symText(inner.elems[1]!);
    return n ? [n] : [];
  }
  if (kw === "variant") {
    const names: string[] = [];
    const n = nameText(inner.elems[1]!);
    if (n) names.push(n);
    for (let i = 2; i < inner.elems.length; i++) {
      const c = inner.elems[i]!;
      if (c.tag === "list" && c.elems[0]) {
        const cn = symText(c.elems[0]);
        if (cn) names.push(cn);
      }
    }
    return names;
  }
  return [];
}

function freshAppend(taken: Set<string>): string {
  if (!taken.has("mn-rest-append")) return "mn-rest-append";
  let i = 1;
  while (taken.has(`mn-rest-append-${i}`)) i++;
  return `mn-rest-append-${i}`;
}

/** Exported rest functions: name → number of fixed parameters. */
export function restExportSigs(forms: Ast[], exports: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of forms) {
    const name = definedName(f);
    const fixed = restFixed(f, null);
    if (name && fixed !== null && exports.has(name)) out.set(name, fixed);
  }
  return out;
}

export function packRest(
  forms: Ast[],
  imported: ReadonlyMap<string, number> = new Map(),
  blocked: ReadonlySet<string> = new Set(),
): PackResult {
  const diags: Diagnostic[] = [];
  const local = new Map<string, number>();
  const decl = new Set<string>();
  for (const f of forms) {
    for (const n of declNames(f)) decl.add(n);
    const name = definedName(f);
    const fixed = restFixed(f, diags);
    if (name && fixed !== null) local.set(name, fixed);
    else if (name) local.delete(name);
  }
  const active = new Map(imported);
  for (const n of decl) {
    if (local.has(n)) active.set(n, local.get(n)!);
    else active.delete(n);
  }
  const taken = new Set<string>([...decl, ...blocked]);
  const ctx: Ctx = {
    active,
    diags,
    appendName: freshAppend(taken),
    need: false,
    needSpan: { start: 0, end: 0 },
  };
  const rewritten = forms.map((f) => rewriteForm(f, ctx));
  if (ctx.need) rewritten.push(appendDefn(ctx.appendName, ctx.needSpan));
  return { ok: diags.length === 0, forms: rewritten, diagnostics: diags };
}

function rewriteForm(form: Ast, ctx: Ctx): Ast {
  const u = unwrapPub(form);
  const inner = rewriteDecl(u.inner, ctx);
  if (!u.exported || form.tag !== "list" || inner.tag !== "list") return inner;
  return list(form.kind, [form.elems[0]!, ...inner.elems], form.span);
}

function rewriteDecl(form: Ast, ctx: Ctx): Ast {
  if (form.tag !== "list" || form.elems.length === 0) return rewriteValue(form, ctx);
  const kw = symText(form.elems[0]!);
  if (kw !== "defn" && kw !== "extern" && kw !== "runtime") return rewriteValue(form, ctx);
  const arrow = form.elems.findIndex((e, i) => i >= 2 && isSym(e, "->"));
  if (arrow < 0 || arrow + 1 >= form.elems.length) return form;
  const prefix = stripPrefix(form.elems.slice(0, arrow + 2));
  const body = form.elems.slice(arrow + 2).map((e) => rewriteValue(e, ctx));
  return list(form.kind, [...prefix, ...body], form.span);
}

function stripPrefix(elems: Ast[]): Ast[] {
  const arrow = elems.findIndex((e) => isSym(e, "->"));
  const head = (arrow < 0 ? elems : elems.slice(0, arrow)).map(stripParam);
  const tail = arrow < 0 ? [] : elems.slice(arrow);
  return [...head, ...tail];
}

function stripParam(ast: Ast): Ast {
  if (ast.tag !== "list" || ast.kind !== "paren" || ast.elems.length === 0) return ast;
  if (!isDots(ast.elems[ast.elems.length - 1]!)) return ast;
  return list("paren", ast.elems.slice(0, -1), ast.span);
}

function rewriteValue(ast: Ast, ctx: Ctx): Ast {
  const out = rewriteExpr(ast, ctx);
  if (isDots(out)) {
    push(ctx.diags, out.span, "E_TYPE_SPREAD", "spread takes one expression");
    return out;
  }
  return out;
}

function rewriteExpr(ast: Ast, ctx: Ctx): Ast {
  if (ast.tag !== "list") return ast;
  if (ast.kind === "bracket") {
    return list("bracket", ast.elems.map((e) => rewriteExpr(e, ctx)), ast.span);
  }
  return rewriteParen(ast.elems, ast.span, ctx);
}

function rewriteParen(elems: Ast[], span: Span, ctx: Ctx): Ast {
  if (elems.length === 0) return list("paren", [], span);
  const head = elems[0]!;
  const args = elems.slice(1);
  const name = symText(head);
  if (name === "quote") return list("paren", elems, span);
  if (name === "fn" || name === "lambda") return rewriteLambda(elems, span, ctx);
  if (name === "...") {
    push(ctx.diags, span, "E_TYPE_SPREAD", "`...` marks the next argument; it is not a call");
    return list("paren", elems, span);
  }
  if (name !== null) return finishCall(head, name, args, span, ctx);
  const h = rewriteValue(head, ctx);
  const hn = symText(h);
  if (hn !== null) return finishCall(h, hn, args, span, ctx);
  const split = splitPieces(args, ctx);
  if (split.bad) return list("paren", [h, ...split.pieces.map(pieceExpr)], span);
  return finishPlain(h, split, span, ctx);
}

function rewriteLambda(elems: Ast[], span: Span, ctx: Ctx): Ast {
  const params = elems[1];
  if (!params) return list("paren", elems, span);
  if (containsDots(params)) {
    push(ctx.diags, dotsSpan(params), "E_TYPE_REST", "`...` is not allowed on a lambda");
  }
  const body = elems.slice(2).map((e) => rewriteValue(e, ctx));
  return list("paren", [elems[0]!, params, ...body], span);
}

function finishCall(head: Ast, name: string, args: Ast[], span: Span, ctx: Ctx): Ast {
  const split = splitPieces(args, ctx);
  if (split.bad) return list("paren", [head, ...split.pieces.map(pieceExpr)], span);
  const fixed = ctx.active.get(name);
  if (fixed === undefined) return finishPlain(head, split, span, ctx);
  return packNamed(head, fixed, split.pieces, span, ctx);
}

function finishPlain(
  head: Ast,
  split: { pieces: Piece[]; bad: boolean },
  span: Span,
  ctx: Ctx,
): Ast {
  const splice = split.pieces.find((p) => p.kind === "splice");
  if (splice && splice.kind === "splice") {
    push(ctx.diags, splice.span, "E_TYPE_SPREAD", "spread is only valid in a rest-parameter call");
  }
  return list("paren", [head, ...split.pieces.map(pieceExpr)], span);
}

function packNamed(head: Ast, fixed: number, pieces: Piece[], span: Span, ctx: Ctx): Ast {
  if (pieces.length < fixed) {
    const splice = pieces.find((p) => p.kind === "splice");
    if (splice && splice.kind === "splice") {
      push(ctx.diags, splice.span, "E_TYPE_SPREAD", "spread in a fixed argument");
    }
    return list("paren", [head, ...pieces.map(pieceExpr)], span);
  }
  const headPieces = pieces.slice(0, fixed);
  const restPieces = pieces.slice(fixed);
  const bad = headPieces.find((p) => p.kind === "splice");
  if (bad && bad.kind === "splice") {
    push(ctx.diags, bad.span, "E_TYPE_SPREAD", "spread in a fixed argument");
    return list("paren", [head, ...pieces.map(pieceExpr)], span);
  }
  const packed = buildRest(restPieces, span, ctx);
  return list("paren", [head, ...headPieces.map(pieceExpr), packed], span);
}

function pieceExpr(p: Piece): Ast {
  return p.expr;
}

function splitPieces(args: Ast[], ctx: Ctx): { pieces: Piece[]; bad: boolean } {
  const pieces: Piece[] = [];
  let bad = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (isDots(a)) {
      const next = args[i + 1];
      if (!next || isDots(next)) {
        push(ctx.diags, a.span, "E_TYPE_SPREAD", "spread takes one expression");
        bad = true;
      } else {
        pieces.push({ kind: "splice", expr: rewriteValue(next, ctx), span: a.span });
        i++;
      }
    } else {
      pieces.push({ kind: "elem", expr: rewriteExpr(a, ctx) });
    }
  }
  return { pieces, bad };
}

function nilNode(span: Span): Ast {
  return list("paren", [sym("Nil", span)], span);
}

function isNilNode(ast: Ast): boolean {
  return ast.tag === "list" && ast.kind === "paren" && ast.elems.length === 1 && isSym(ast.elems[0]!, "Nil");
}

function buildRest(pieces: Piece[], span: Span, ctx: Ctx): Ast {
  let acc = nilNode(span);
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]!;
    if (p.kind === "splice") {
      if (isNilNode(acc)) acc = p.expr;
      else {
        ctx.need = true;
        ctx.needSpan = p.span;
        acc = list("paren", [sym(ctx.appendName, span), p.expr, acc], span);
      }
    } else {
      acc = list("paren", [sym("Cons", span), p.expr, acc], span);
    }
  }
  return acc;
}

function appendDefn(name: string, span: Span): Ast {
  const a = sym("a", span);
  const listA = list("paren", [sym("List", span), a], span);
  const xs = list("paren", [sym("xs:", span), listA], span);
  const ys = list("paren", [sym("ys:", span), list("paren", [sym("List", span), sym("a", span)], span)], span);
  const rec = list("paren", [sym(name, span), sym("t", span), sym("ys", span)], span);
  const consBody = list("paren", [sym("Cons", span), sym("h", span), rec], span);
  const match = list(
    "paren",
    [
      sym("match", span),
      sym("xs", span),
      list("paren", [sym("Nil", span)], span),
      sym("ys", span),
      list("paren", [sym("Cons", span), sym("h", span), sym("t", span)], span),
      consBody,
    ],
    span,
  );
  return list(
    "paren",
    [
      sym("defn", span),
      list("paren", [sym(name, span), list("bracket", [a], span)], span),
      xs,
      ys,
      sym("->", span),
      list("paren", [sym("List", span), sym("a", span)], span),
      match,
    ],
    span,
  );
}
