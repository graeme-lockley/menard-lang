/**
 * LANG-07 codemod: rewrite nullary constructor calls `None()` / `Red()` to
 * bare values `None` / `Red`. Skips match/mmatch pattern positions and leaves
 * payload constructors (`Some(1)`, `Err()` in a pipe) alone.
 */
import type { Ast } from "../reader/ast.ts";
import { nameEquals } from "../reader/ast.ts";
import { parseProgram } from "../reader/parse.ts";

const BUILTIN_NULLARIES = [
  "None",
  "Nil",
  "NotFound",
  "Permission",
  "Exists",
  "IsADirectory",
  "NotADirectory",
  "InvalidPath",
  "TooLarge",
  "Timeout",
  "TlsVerifyFailed",
  "Unsupported",
  "TlsHandshakeFailed",
  "NotExecutable",
  "InvalidArgument",
  "TooManyArguments",
];

export type NullaryRewrite = {
  start: number;
  end: number;
  name: string;
};

function symText(ast: Ast): string | null {
  if (ast.tag !== "sym") return null;
  return new TextDecoder().decode(ast.name);
}

/** Collect arity-0 constructor names from `variant` forms in this program. */
export function collectNullaryNames(forms: Ast[], extra: Iterable<string> = BUILTIN_NULLARIES): Set<string> {
  const out = new Set<string>(extra);
  for (const form of forms) collectFromForm(form, out);
  return out;
}

function collectVariantCtors(elems: Ast[], nameIndex: number, out: Set<string>): void {
  for (let i = nameIndex + 1; i < elems.length; i++) {
    const ctor = elems[i]!;
    if (ctor.tag === "list" && ctor.kind === "paren" && ctor.elems.length === 1) {
      const n = symText(ctor.elems[0]!);
      if (n) out.add(n);
    }
  }
}

function collectFromForm(ast: Ast, out: Set<string>): void {
  if (ast.tag !== "list" || ast.kind !== "paren" || ast.elems.length < 2) return;
  const head = ast.elems[0]!;
  if (head.tag !== "sym") return;
  // `variant Name | Ctor …` or flat `pub variant Name | Ctor …`
  if (nameEquals(head.name, "variant")) {
    collectVariantCtors(ast.elems, 1, out);
    return;
  }
  if (
    nameEquals(head.name, "pub") &&
    ast.elems[1]?.tag === "sym" &&
    nameEquals((ast.elems[1] as { tag: "sym"; name: Uint8Array }).name, "variant")
  ) {
    collectVariantCtors(ast.elems, 2, out);
  }
}

function isNullaryCall(ast: Ast, nullaries: Set<string>): string | null {
  if (ast.tag !== "list" || ast.kind !== "paren" || ast.elems.length !== 1) return null;
  const n = symText(ast.elems[0]!);
  if (!n || !nullaries.has(n)) return null;
  // Synthetic pattern parens span only the name; real `Name()` covers the `()`.
  if (ast.span.end - ast.span.start <= n.length) return null;
  return n;
}

/**
 * Walk expression positions. Match/mmatch pattern slots (alternating after the
 * scrutinee) are skipped so `| Permanent() ->` is left alone.
 */
export function findNullaryRewrites(forms: Ast[], nullaries: Set<string>): NullaryRewrite[] {
  const out: NullaryRewrite[] = [];
  for (const form of forms) walkExpr(form, nullaries, out);
  // Apply right-to-left so offsets stay valid.
  out.sort((a, b) => b.start - a.start);
  return out;
}

function walkExpr(ast: Ast, nullaries: Set<string>, out: NullaryRewrite[]): void {
  const name = isNullaryCall(ast, nullaries);
  if (name !== null) {
    out.push({ start: ast.span.start, end: ast.span.end, name });
    return;
  }
  if (ast.tag !== "list") return;
  const head = ast.elems[0];
  const hn = head && head.tag === "sym" ? symText(head) : null;
  if (hn === "match" || hn === "mmatch") {
    walkMatch(ast, nullaries, out);
    return;
  }
  for (const e of ast.elems) walkExpr(e, nullaries, out);
}

function walkMatch(ast: Ast & { tag: "list" }, nullaries: Set<string>, out: NullaryRewrite[]): void {
  // (match scrut pat body pat body …) or (mmatch scruts pat body …)
  if (ast.elems.length < 2) return;
  walkExpr(ast.elems[1]!, nullaries, out);
  for (let i = 2; i < ast.elems.length; i += 2) {
    // skip pattern at i; walk body at i+1
    if (i + 1 < ast.elems.length) walkExpr(ast.elems[i + 1]!, nullaries, out);
  }
}

export function applyRewrites(source: string, rewrites: NullaryRewrite[]): string {
  let out = source;
  for (const r of rewrites) {
    out = out.slice(0, r.start) + r.name + out.slice(r.end);
  }
  return out;
}

export type FixResult =
  | { ok: true; source: string; rewrites: NullaryRewrite[]; changed: boolean }
  | { ok: false; error: string };

/** Rewrite one source buffer. `extraNullaries` merges project-wide names. */
export function fixNullaryCtor(
  source: string | Uint8Array,
  extraNullaries: Iterable<string> = [],
): FixResult {
  const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
  const text = typeof source === "string" ? source : new TextDecoder().decode(source);
  const parsed = parseProgram(bytes);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error.message };
  }
  const nullaries = collectNullaryNames(parsed.forms, [...BUILTIN_NULLARIES, ...extraNullaries]);
  const rewrites = findNullaryRewrites(parsed.forms, nullaries);
  const next = applyRewrites(text, rewrites);
  return { ok: true, source: next, rewrites, changed: next !== text };
}

/** Text-level rewrite used for repo migration (also fixes `| Name() ->` patterns). */
export function rewriteNullaryCallsText(source: string, nullaries: Set<string>): string {
  const names = [...nullaries].sort((a, b) => b.length - a.length);
  if (names.length === 0) return source;
  const re = new RegExp(`\\b(${names.map(escapeRe).join("|")})\\(\\)`, "g");
  return source.replace(re, "$1");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { BUILTIN_NULLARIES };
