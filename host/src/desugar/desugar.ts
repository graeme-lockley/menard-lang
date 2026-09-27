import type { Ast } from "../reader/ast.ts";
import { nameEquals, symName } from "../reader/ast.ts";
import type { Diagnostic } from "../diagnostic/diagnostic.ts";
import { diagnostic } from "../diagnostic/diagnostic.ts";

export type DesugarResult =
  | { ok: true; forms: Ast[] }
  | { ok: false; diagnostics: Diagnostic[] };

function isSym(ast: Ast, name: string): boolean {
  return ast.tag === "sym" && nameEquals(ast.name, name);
}

function list(kind: "paren" | "bracket", elems: Ast[], span: Ast["span"]): Ast {
  return { tag: "list", kind, elems, span };
}

function sym(name: string, span: Ast["span"]): Ast {
  return { tag: "sym", name: symName(name), span };
}

/** Desugar one form; recursively desugars children. */
export function desugarForm(ast: Ast): DesugarResult {
  const diags: Diagnostic[] = [];
  const out = desugarNode(ast, diags);
  if (diags.length > 0) return { ok: false, diagnostics: diags };
  return { ok: true, forms: [out] };
}

export function desugarAll(forms: Ast[]): DesugarResult {
  const diags: Diagnostic[] = [];
  const out: Ast[] = [];
  for (const f of forms) {
    out.push(desugarNode(f, diags));
  }
  if (diags.length > 0) return { ok: false, diagnostics: diags };
  return { ok: true, forms: out };
}

function mapElems(elems: Ast[], diags: Diagnostic[]): Ast[] {
  return elems.map((e) => desugarNode(e, diags));
}

/** `[e1 e2 …]` → `(Cons e1 (Cons e2 (Nil)))`. `[]` → `(Nil)`. */
function consChain(elems: Ast[], span: Ast["span"]): Ast {
  let acc = list("paren", [sym("Nil", span)], span);
  for (let i = elems.length - 1; i >= 0; i--) {
    acc = list("paren", [sym("Cons", span), elems[i]!, acc], span);
  }
  return acc;
}

function isDeclKeyword(ast: Ast): boolean {
  return isSym(ast, "defn") || isSym(ast, "defrec") || isSym(ast, "variant");
}

/**
 * `(name [params…])` in a defn/defrec/variant head. The bracket list is
 * type parameters, not a value list.
 */
function desugarNameForm(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const name = ast.elems[0];
  const params = ast.elems[1];
  if (
    name !== undefined &&
    params !== undefined &&
    params.tag === "list" &&
    params.kind === "bracket"
  ) {
    const rest = ast.elems.slice(2).map((e) => desugarNode(e, diags));
    return list(
      "paren",
      [
        desugarNode(name, diags),
        list("bracket", mapElems(params.elems, diags), params.span),
        ...rest,
      ],
      ast.span,
    );
  }
  return list("paren", mapElems(ast.elems, diags), ast.span);
}

function desugarDecl(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const kw = ast.elems[0]!;
  const name = ast.elems[1];
  if (name === undefined) {
    return list("paren", mapElems(ast.elems, diags), ast.span);
  }
  const nameOut =
    name.tag === "list" && name.kind === "paren"
      ? desugarNameForm(name, diags)
      : desugarNode(name, diags);
  const rest = ast.elems.slice(2).map((e) => desugarNode(e, diags));
  return list("paren", [desugarNode(kw, diags), nameOut, ...rest], ast.span);
}

function desugarPub(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const kw = ast.elems[1];
  const name = ast.elems[2];
  if (kw === undefined || !isDeclKeyword(kw) || name === undefined) {
    return list("paren", mapElems(ast.elems, diags), ast.span);
  }
  const nameOut =
    name.tag === "list" && name.kind === "paren"
      ? desugarNameForm(name, diags)
      : desugarNode(name, diags);
  const rest = ast.elems.slice(3).map((e) => desugarNode(e, diags));
  return list(
    "paren",
    [desugarNode(ast.elems[0]!, diags), desugarNode(kw, diags), nameOut, ...rest],
    ast.span,
  );
}

function desugarNode(ast: Ast, diags: Diagnostic[]): Ast {
  if (ast.tag === "list" && ast.kind === "bracket") {
    return consChain(mapElems(ast.elems, diags), ast.span);
  }
  if (ast.tag !== "list" || ast.kind !== "paren" || ast.elems.length === 0) {
    if (ast.tag === "list") {
      return list(ast.kind, mapElems(ast.elems, diags), ast.span);
    }
    return ast;
  }

  const head = ast.elems[0]!;
  if (head.tag !== "sym") {
    return list("paren", mapElems(ast.elems, diags), ast.span);
  }

  if (isDeclKeyword(head)) return desugarDecl(ast, diags);
  if (nameEquals(head.name, "pub")) return desugarPub(ast, diags);
  if (nameEquals(head.name, "and")) return desugarAnd(ast, diags);
  if (nameEquals(head.name, "or")) return desugarOr(ast, diags);
  if (nameEquals(head.name, "cond")) return desugarCond(ast, diags);
  if (nameEquals(head.name, "when")) return desugarWhen(ast, diags);
  if (nameEquals(head.name, "while")) return desugarWhile(ast, diags);

  return list("paren", mapElems(ast.elems, diags), ast.span);
}

function desugarAnd(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  // (and) → true; (and x) → x; (and x y …) → (if x (and y …) false)
  const args = ast.elems.slice(1);
  if (args.length === 0) {
    return { tag: "bool", value: true, span: ast.span };
  }
  if (args.length === 1) return desugarNode(args[0]!, diags);
  const [x, ...rest] = args;
  const restForm = list(
    "paren",
    [sym("and", ast.span), ...rest],
    ast.span,
  );
  return desugarNode(
    list(
      "paren",
      [
        sym("if", ast.span),
        x!,
        restForm,
        { tag: "bool", value: false, span: ast.span },
      ],
      ast.span,
    ),
    diags,
  );
}

function desugarOr(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const args = ast.elems.slice(1);
  if (args.length === 0) {
    return { tag: "bool", value: false, span: ast.span };
  }
  if (args.length === 1) return desugarNode(args[0]!, diags);
  const [x, ...rest] = args;
  const restForm = list("paren", [sym("or", ast.span), ...rest], ast.span);
  return desugarNode(
    list(
      "paren",
      [
        sym("if", ast.span),
        x!,
        x!,
        restForm,
      ],
      ast.span,
    ),
    diags,
  );
}

function desugarCond(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  // (cond (test e…) … (else e…))
  const clauses = ast.elems.slice(1);
  if (clauses.length === 0) {
    diags.push(
      diagnostic({
        severity: "error",
        category: "semantic",
        code: "E_DESUGAR_COND_EMPTY",
        message: "cond requires at least one clause",
        span: ast.span,
      }),
    );
    return ast;
  }
  return desugarCondClauses(clauses, ast.span, diags);
}

function desugarCondClauses(
  clauses: Ast[],
  span: Ast["span"],
  diags: Diagnostic[],
): Ast {
  if (clauses.length === 0) {
    return list("paren", [sym("panic", span), { tag: "str", bytes: symName("cond: no match"), span }], span);
  }
  const [first, ...rest] = clauses;
  if (first!.tag !== "list" || first!.kind !== "paren" || first!.elems.length < 1) {
    diags.push(
      diagnostic({
        severity: "error",
        category: "semantic",
        code: "E_DESUGAR_COND_CLAUSE",
        message: "cond clause must be a list (test exprs…)",
        span: first!.span,
      }),
    );
    return first!;
  }
  const test = first!.elems[0]!;
  const body = first!.elems.slice(1);
  if (isSym(test, "else")) {
    if (rest.length > 0) {
      diags.push(
        diagnostic({
          severity: "error",
          category: "semantic",
          code: "E_DESUGAR_COND_ELSE",
          message: "else must be the last cond clause",
          span: test.span,
        }),
      );
    }
    if (body.length === 0) {
      return { tag: "list", kind: "paren", elems: [], span }; // Unit
    }
    if (body.length === 1) return desugarNode(body[0]!, diags);
    return desugarNode(list("paren", [sym("do", span), ...body], span), diags);
  }
  const thenExpr =
    body.length === 0
      ? { tag: "list" as const, kind: "paren" as const, elems: [], span }
      : body.length === 1
        ? body[0]!
        : list("paren", [sym("do", span), ...body], span);
  const elseExpr = desugarCondClauses(rest, span, diags);
  return desugarNode(
    list("paren", [sym("if", span), test, thenExpr, elseExpr], span),
    diags,
  );
}

function desugarWhen(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  // (when test body…) → (if test (do body…) ())
  if (ast.elems.length < 2) {
    diags.push(
      diagnostic({
        severity: "error",
        category: "semantic",
        code: "E_DESUGAR_WHEN",
        message: "when requires a test and optional body",
        span: ast.span,
      }),
    );
    return ast;
  }
  const test = ast.elems[1]!;
  const body = ast.elems.slice(2);
  const thenExpr =
    body.length === 0
      ? list("paren", [], ast.span)
      : body.length === 1
        ? body[0]!
        : list("paren", [sym("do", ast.span), ...body], ast.span);
  return desugarNode(
    list(
      "paren",
      [sym("if", ast.span), test, thenExpr, list("paren", [], ast.span)],
      ast.span,
    ),
    diags,
  );
}

function desugarWhile(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  // (while test body…) → (loop () (if test (do body… (recur)) ()))
  if (ast.elems.length < 2) {
    diags.push(
      diagnostic({
        severity: "error",
        category: "semantic",
        code: "E_DESUGAR_WHILE",
        message: "while requires a test",
        span: ast.span,
      }),
    );
    return ast;
  }
  const test = ast.elems[1]!;
  const body = ast.elems.slice(2);
  const recur = list("paren", [sym("recur", ast.span)], ast.span);
  const bodyDo =
    body.length === 0
      ? recur
      : list("paren", [sym("do", ast.span), ...body, recur], ast.span);
  const ifForm = list(
    "paren",
    [sym("if", ast.span), test, bodyDo, list("paren", [], ast.span)],
    ast.span,
  );
  return desugarNode(
    list("paren", [sym("loop", ast.span), list("paren", [], ast.span), ifForm], ast.span),
    diags,
  );
}
