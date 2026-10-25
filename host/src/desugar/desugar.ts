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
  return (
    isSym(ast, "defn") ||
    isSym(ast, "defrec") ||
    isSym(ast, "variant") ||
    isSym(ast, "runtime") ||
    isSym(ast, "extern")
  );
}

/**
 * `(name [params…])` in a defn/defrec/variant/runtime head. The bracket list is
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
  if (kw.tag === "sym" && nameEquals(kw.name, "defn")) {
    const inner: Ast & { tag: "list" } = {
      tag: "list",
      kind: "paren",
      elems: ast.elems.slice(1),
      span: ast.span,
    };
    const desugared = desugarDefn(inner, diags);
    if (desugared.tag !== "list") {
      return list("paren", [desugarNode(ast.elems[0]!, diags), desugared], ast.span);
    }
    return list("paren", [desugarNode(ast.elems[0]!, diags), ...desugared.elems], ast.span);
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

  if (nameEquals(head.name, "defn")) return desugarDefn(ast, diags);
  if (nameEquals(head.name, "fn") || nameEquals(head.name, "lambda")) {
    return desugarFn(ast, diags);
  }
  if (isDeclKeyword(head)) return desugarDecl(ast, diags);
  if (nameEquals(head.name, "pub")) return desugarPub(ast, diags);
  if (nameEquals(head.name, "and")) return desugarAnd(ast, diags);
  if (nameEquals(head.name, "or")) return desugarOr(ast, diags);
  if (nameEquals(head.name, "cond")) return desugarCond(ast, diags);
  if (nameEquals(head.name, "when")) return desugarWhen(ast, diags);
  if (nameEquals(head.name, "while")) return desugarWhile(ast, diags);
  if (nameEquals(head.name, "|>")) return desugarPipe(ast, diags);
  if (nameEquals(head.name, "?")) return desugarQues(ast, diags);
  if (nameEquals(head.name, "map-lit")) return desugarMapLit(ast, diags);
  if (nameEquals(head.name, "mmatch")) return desugarMMatch(ast, diags);
  const op = headText(head);
  if (op !== null && FOLD_OPS.has(op)) return desugarFold(op, ast, diags);
  if (op !== null && SUB_OPS.has(op)) return desugarSub(op, ast, diags);
  if (op !== null && DIV_OPS.has(op)) return desugarDiv(op, ast, diags);
  if (op !== null && CMP_OPS.has(op)) return desugarCmp(op, ast, diags);

  return list("paren", mapElems(ast.elems, diags), ast.span);
}

function headText(head: Ast): string | null {
  if (head.tag !== "sym") return null;
  return new TextDecoder().decode(head.name);
}

// Left fold into the binary intrinsic. One argument is the identity.
// `+`, `*`, `f+`, `f*`. String concat folds later, once the callee is
// known to be std/string's concat.
const FOLD_OPS = new Set(["+", "*", "f+", "f*"]);
// Left fold; one argument is negation (`(- x)` → `(- 0 x)`, `(f- x)` → `(f- 0.0 x)`).
const SUB_OPS = new Set(["-", "f-"]);
// Left fold; at least two arguments.
const DIV_OPS = new Set(["/", "f/"]);
// Chain: `(< a b c)` → `(and (< a b) (< b c))`. Middle operands are evaluated twice.
const CMP_OPS = new Set(["<", ">", "<=", ">=", "="]);

const PIPE_BLOCKED = new Set([
  "project",
  "if",
  "do",
  "cond",
  "when",
  "match",
  "mmatch",
  "fn",
  "let",
  "loop",
  "while",
  "and",
  "or",
  "quote",
  "char",
  "tuple",
  "Cons",
  "Nil",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "<=",
  ">=",
  "=",
  "|>",
  "f+",
  "f-",
  "f*",
  "f/",
  "::",
]);

/**
 * `(defn name (param PAT T) … -> Ret body)` → simple params plus a match wrap
 * so the runtime only sees name bindings.
 */
function desugarDefn(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const base = desugarDecl(ast, diags);
  if (base.tag !== "list") return base;
  let arrow = -1;
  for (let i = 2; i < base.elems.length; i++) {
    const e = base.elems[i]!;
    if (e.tag === "sym" && nameEquals(e.name, "->")) {
      arrow = i;
      break;
    }
  }
  if (arrow < 0) return base;
  const params = base.elems.slice(2, arrow);
  const after = base.elems.slice(arrow);
  const newParams: Ast[] = [];
  const wraps: { name: Ast; pat: Ast }[] = [];
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    if (
      p.tag === "list" &&
      p.elems[0]?.tag === "sym" &&
      nameEquals(p.elems[0].name, "param") &&
      p.elems[1] &&
      p.elems[2]
    ) {
      const pname = sym(`__p${i}`, p.span);
      newParams.push(
        list("paren", [sym(`__p${i}:`, p.span), desugarNode(p.elems[2], diags)], p.span),
      );
      wraps.push({ name: pname, pat: desugarNode(p.elems[1], diags) });
    } else {
      newParams.push(desugarNode(p, diags));
    }
  }
  if (wraps.length === 0) return base;
  // body is everything after return type
  const ret = after[1]!;
  let bodyForms = after.slice(2).map((e) => desugarNode(e, diags));
  let body: Ast =
    bodyForms.length === 1
      ? bodyForms[0]!
      : list("paren", [sym("do", ast.span), ...bodyForms], ast.span);
  for (let i = wraps.length - 1; i >= 0; i--) {
    const w = wraps[i]!;
    body = list("paren", [sym("match", w.pat.span), w.name, w.pat, body], w.pat.span);
  }
  return list(
    "paren",
    [desugarNode(base.elems[0]!, diags), desugarNode(base.elems[1]!, diags), ...newParams, sym("->", ret.span), ret, body],
    ast.span,
  );
}

/**
 * `(fn (param PAT T | tuple… | name: T | name) …)` → bare/`name: T` params
 * plus match wraps, matching `desugarDefn` / parse-time `wrapPatternParams`.
 */
function desugarFn(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const head = desugarNode(ast.elems[0]!, diags);
  const paramsAst = ast.elems[1];
  if (!paramsAst || paramsAst.tag !== "list") {
    return list("paren", mapElems(ast.elems, diags), ast.span);
  }
  let ret: Ast | null = null;
  let body: Ast;
  if (
    ast.elems.length >= 5 &&
    ast.elems[2]?.tag === "sym" &&
    nameEquals(ast.elems[2].name, "->")
  ) {
    ret = desugarNode(ast.elems[3]!, diags);
    body = desugarNode(ast.elems[4]!, diags);
  } else if (ast.elems[2]) {
    body = desugarNode(ast.elems[2], diags);
  } else {
    return list("paren", mapElems(ast.elems, diags), ast.span);
  }

  const newParams: Ast[] = [];
  const wraps: { name: Ast; pat: Ast }[] = [];
  for (let i = 0; i < paramsAst.elems.length; i++) {
    const p = paramsAst.elems[i]!;
    if (
      p.tag === "list" &&
      p.elems[0]?.tag === "sym" &&
      nameEquals(p.elems[0].name, "param") &&
      p.elems[1] &&
      p.elems[2]
    ) {
      const pname = sym(`__p${i}`, p.span);
      newParams.push(
        list("paren", [sym(`__p${i}:`, p.span), desugarNode(p.elems[2], diags)], p.span),
      );
      wraps.push({ name: pname, pat: desugarNode(p.elems[1], diags) });
    } else if (
      p.tag === "list" &&
      p.elems[0]?.tag === "sym" &&
      nameEquals(p.elems[0].name, "tuple")
    ) {
      const pname = sym(`__p${i}`, p.span);
      newParams.push(pname);
      wraps.push({ name: pname, pat: desugarNode(p, diags) });
    } else {
      newParams.push(desugarNode(p, diags));
    }
  }

  for (let i = wraps.length - 1; i >= 0; i--) {
    const w = wraps[i]!;
    body = list("paren", [sym("match", w.pat.span), w.name, w.pat, body], w.pat.span);
  }

  const paramsOut = list("paren", newParams, paramsAst.span);
  if (ret !== null) {
    return list("paren", [head, paramsOut, sym("->", ret.span), ret, body], ast.span);
  }
  return list("paren", [head, paramsOut, body], ast.span);
}

/** A call is a parenthesized application. A bare name or a projection is not. */
function isPipeCall(ast: Ast): ast is Ast & { tag: "list" } {
  if (ast.tag !== "list" || ast.kind !== "paren" || ast.elems.length === 0) return false;
  const head = ast.elems[0]!;
  if (head.tag === "sym") {
    const name = headText(head);
    return name !== null && !PIPE_BLOCKED.has(name);
  }
  return head.tag === "list";
}

function desugarPipe(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const lhs = ast.elems[1];
  const rhs = ast.elems[2];
  if (!lhs || !rhs || ast.elems.length !== 3) {
    pushArity(diags, ast.span, "|>", "a value and a call");
    return list("paren", mapElems(ast.elems, diags), ast.span);
  }
  if (isMapLit(rhs)) {
    diags.push(
      diagnostic({
        severity: "error",
        category: "semantic",
        code: "E_DESUGAR_PIPE",
        message: "pipe expects a call",
        span: ast.span,
      }),
    );
    return list("paren", [sym("|>", ast.span), desugarNode(lhs, diags), desugarNode(rhs, diags)], ast.span);
  }
  const left = desugarNode(lhs, diags);
  const right = desugarNode(rhs, diags);
  if (!isPipeCall(right)) {
    diags.push(
      diagnostic({
        severity: "error",
        category: "semantic",
        code: "E_DESUGAR_PIPE",
        message: "pipe expects a call",
        span: ast.span,
      }),
    );
    return list("paren", [sym("|>", ast.span), left, right], ast.span);
  }
  return list("paren", [...right.elems, left], ast.span);
}

function isMapLit(ast: Ast): boolean {
  return ast.tag === "list" && ast.kind === "paren" && ast.elems[0]?.tag === "sym" && nameEquals(ast.elems[0].name, "map-lit");
}

/** Keep `(? lhs rhs)`; the typer rewrites Maybe/Result to a short-circuiting match. */
function desugarQues(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const lhs = ast.elems[1];
  const rhs = ast.elems[2];
  if (!lhs || !rhs || ast.elems.length !== 3) {
    pushArity(diags, ast.span, "?", "a Maybe or Result and a default");
    return list("paren", mapElems(ast.elems, diags), ast.span);
  }
  return list(
    "paren",
    [sym("?", ast.span), desugarNode(lhs, diags), desugarNode(rhs, diags)],
    ast.span,
  );
}

/** `(map-lit entry…)` folds onto `(map-new)`. A pair is `map-set`. A spread merges once. */
function desugarMapLit(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  let acc: Ast = list("paren", [sym("map-new", ast.span)], ast.span);
  for (const entry of ast.elems.slice(1)) {
    acc = desugarMapEntry(entry, acc, ast.span, diags);
  }
  return acc;
}

function desugarMapEntry(entry: Ast, acc: Ast, span: Ast["span"], diags: Diagnostic[]): Ast {
  if (entry.tag === "list" && entry.kind === "paren" && entry.elems[0]?.tag === "sym") {
    const head = entry.elems[0];
    if (nameEquals(head.name, "=>") && entry.elems.length === 3) {
      return list(
        "paren",
        [sym("map-set", span), acc, desugarNode(entry.elems[1]!, diags), desugarNode(entry.elems[2]!, diags)],
        span,
      );
    }
    if (nameEquals(head.name, "...") && entry.elems.length === 2) {
      return desugarMapSpread(acc, desugarNode(entry.elems[1]!, diags), span);
    }
  }
  diags.push(
    diagnostic({
      severity: "error",
      category: "semantic",
      code: "E_DESUGAR_MAP",
      message: "map entry must be a pair or a spread",
      span: entry.span,
    }),
  );
  return acc;
}

/** Bind the base and the spread outside the loop so neither captures the other. */
function desugarMapSpread(base: Ast, src: Ast, span: Ast["span"]): Ast {
  const baseName = sym("mn-map-base", span);
  const srcName = sym("mn-map-src", span);
  const accName = sym("mn-map-acc", span);
  const ksName = sym("mn-map-ks", span);
  const keyName = sym("mn-map-k", span);
  const restName = sym("mn-map-rest", span);
  const valName = sym("mn-map-v", span);
  const recurSome = list(
    "paren",
    [sym("recur", span), list("paren", [sym("map-set", span), accName, keyName, valName], span), restName],
    span,
  );
  const recurNone = list("paren", [sym("recur", span), accName, restName], span);
  const inner = list(
    "paren",
    [
      sym("match", span),
      list("paren", [sym("map-get", span), srcName, keyName], span),
      list("paren", [sym("Some", span), valName], span),
      recurSome,
      list("paren", [sym("None", span)], span),
      recurNone,
    ],
    span,
  );
  const outer = list(
    "paren",
    [
      sym("match", span),
      ksName,
      list("paren", [sym("Nil", span)], span),
      accName,
      list("paren", [sym("Cons", span), keyName, restName], span),
      inner,
    ],
    span,
  );
  const loop = list(
    "paren",
    [
      sym("loop", span),
      list(
        "paren",
        [
          list("paren", [accName, baseName], span),
          list("paren", [ksName, list("paren", [sym("map-keys", span), srcName], span)], span),
        ],
        span,
      ),
      outer,
    ],
    span,
  );
  return list(
    "paren",
    [
      sym("let", span),
      baseName,
      base,
      list("paren", [sym("let", span), srcName, src, loop], span),
    ],
    span,
  );
}

function pushArity(diags: Diagnostic[], span: Ast["span"], name: string, how: string): void {
  diags.push(
    diagnostic({
      severity: "error",
      category: "semantic",
      code: "E_DESUGAR_ARITY",
      message: `${name} expects ${how}`,
      span,
    }),
  );
}

function binaryCall(name: string, a: Ast, b: Ast, span: Ast["span"], diags: Diagnostic[]): Ast {
  return list("paren", [sym(name, span), desugarNode(a, diags), desugarNode(b, diags)], span);
}

function foldLeft(name: string, args: Ast[], span: Ast["span"]): Ast {
  let acc = args[0]!;
  for (let i = 1; i < args.length; i++) {
    acc = list("paren", [sym(name, span), acc, args[i]!], span);
  }
  return acc;
}

function desugarFold(name: string, ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const args = ast.elems.slice(1);
  if (args.length === 0) {
    pushArity(diags, ast.span, name, "at least 1 argument");
    return ast;
  }
  if (args.length === 1) return desugarNode(args[0]!, diags);
  if (args.length === 2) return binaryCall(name, args[0]!, args[1]!, ast.span, diags);
  return desugarNode(foldLeft(name, args, ast.span), diags);
}

function subZero(name: string, span: Ast["span"]): Ast {
  if (name === "f-") return { tag: "float", value: 0, span };
  return { tag: "int", value: 0n, span };
}

function desugarSub(name: string, ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const args = ast.elems.slice(1);
  if (args.length === 0) {
    pushArity(diags, ast.span, name, "at least 1 argument");
    return ast;
  }
  if (args.length === 1) {
    return desugarNode(
      list("paren", [sym(name, ast.span), subZero(name, ast.span), args[0]!], ast.span),
      diags,
    );
  }
  if (args.length === 2) return binaryCall(name, args[0]!, args[1]!, ast.span, diags);
  return desugarNode(foldLeft(name, args, ast.span), diags);
}

function desugarDiv(name: string, ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const args = ast.elems.slice(1);
  if (args.length < 2) {
    pushArity(diags, ast.span, name, "at least 2 arguments");
    return ast;
  }
  if (args.length === 2) return binaryCall(name, args[0]!, args[1]!, ast.span, diags);
  return desugarNode(foldLeft(name, args, ast.span), diags);
}

function cmpChain(name: string, args: Ast[], span: Ast["span"]): Ast {
  const pairs: Ast[] = [];
  for (let i = 0; i < args.length - 1; i++) {
    pairs.push(list("paren", [sym(name, span), args[i]!, args[i + 1]!], span));
  }
  return list("paren", [sym("and", span), ...pairs], span);
}

function desugarCmp(name: string, ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const args = ast.elems.slice(1);
  if (args.length < 2) {
    pushArity(diags, ast.span, name, "at least 2 arguments");
    return ast;
  }
  if (args.length === 2) return binaryCall(name, args[0]!, args[1]!, ast.span, diags);
  return desugarNode(cmpChain(name, args, ast.span), diags);
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
  // Desugar the test once. A left-nested `||` chain would otherwise walk the
  // left operand twice at every level.
  const dx = desugarNode(x!, diags);
  const drest = desugarNode(list("paren", [sym("or", ast.span), ...rest], ast.span), diags);
  return list("paren", [sym("if", ast.span), dx, dx, drest], ast.span);
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
        message: "cond clause must be a list (test exprs...)",
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

type MArm = { pats: Ast[]; body: Ast; guard: Ast | null };
type PatClass =
  | { kind: "any" }
  | { kind: "ctor"; name: string; payloads: Ast[]; pattern: Ast };

function desugarMMatch(ast: Ast & { tag: "list" }, diags: Diagnostic[]): Ast {
  const scrutList = ast.elems[1];
  if (!scrutList || scrutList.tag !== "list") {
    diags.push(
      diagnostic({
        severity: "error",
        category: "semantic",
        code: "E_DESUGAR_MATCH",
        message: "match requires scrutinees",
        span: ast.span,
      }),
    );
    return ast;
  }
  const scruts = scrutList.elems.map((e) => desugarNode(e, diags));
  const arms: MArm[] = [];
  for (let i = 2; i + 1 < ast.elems.length; i += 2) {
    let node = ast.elems[i]!;
    let guard: Ast | null = null;
    if (node.tag === "list" && isSym(node.elems[0]!, "mguard")) {
      guard = node.elems[2] ? desugarNode(node.elems[2], diags) : null;
      node = node.elems[1]!;
    }
    if (node.tag !== "list" || !isSym(node.elems[0]!, "mpat")) {
      diags.push(
        diagnostic({
          severity: "error",
          category: "semantic",
          code: "E_DESUGAR_MATCH",
          message: "match arm requires a pattern for each scrutinee",
          span: ast.span,
        }),
      );
      continue;
    }
    const pats = node.elems.slice(1).map((p) => desugarNode(p, diags));
    if (pats.length !== scruts.length) {
      diags.push(
        diagnostic({
          severity: "error",
          category: "semantic",
          code: "E_DESUGAR_MATCH",
          message: `pattern has ${pats.length} parts, match has ${scruts.length}`,
          span: node.span,
        }),
      );
      continue;
    }
    arms.push({ pats, body: desugarNode(ast.elems[i + 1]!, diags), guard });
  }
  let freshN = 0;
  const fresh = (span: Ast["span"]): Ast => sym(`__mm${freshN++}`, span);
  return compileMulti(scruts, arms, fresh, ast.span);
}

let recPatId = 0;

function projectCtorName(ast: Ast): string | null {
  if (ast.tag !== "list" || ast.elems.length < 3) return null;
  if (headText(ast.elems[0]!) !== "project") return null;
  return ast.elems[2]?.tag === "sym" ? headText(ast.elems[2]) : null;
}

function classifyPat(pat: Ast): PatClass {
  if (pat.tag === "sym") {
    const n = headText(pat) ?? "_";
    if (n === "_" || isLowerStart(n)) return { kind: "any" };
    return { kind: "ctor", name: n, payloads: [], pattern: list("paren", [pat], pat.span) };
  }
  if (pat.tag === "int") return { kind: "ctor", name: `int:${pat.value}`, payloads: [], pattern: pat };
  if (pat.tag === "str") {
    return { kind: "ctor", name: `str:${new TextDecoder().decode(pat.bytes)}`, payloads: [], pattern: pat };
  }
  if (pat.tag === "bool") return { kind: "ctor", name: `bool:${pat.value}`, payloads: [], pattern: pat };
  // Nullary `Alias.Ctor`.
  if (pat.tag === "list" && headText(pat.elems[0]!) === "project") {
    const n = projectCtorName(pat);
    if (n) return { kind: "ctor", name: n, payloads: [], pattern: pat };
  }
  // `Alias.Ctor(args…)`.
  if (pat.tag === "list" && pat.elems[0]?.tag === "list") {
    const n = projectCtorName(pat.elems[0]);
    if (n) return { kind: "ctor", name: n, payloads: pat.elems.slice(1), pattern: pat };
  }
  if (pat.tag === "list" && pat.elems[0]?.tag === "sym") {
    const n = headText(pat.elems[0]) ?? "";
    if (n === "recpat" && pat.elems[1]?.tag === "sym") {
      const name = headText(pat.elems[1]) ?? "";
      return { kind: "ctor", name: `rec:${name}:${recPatId++}`, payloads: [], pattern: pat };
    }
    if (n !== "guard" && n !== "_" && !isLowerStart(n)) {
      return { kind: "ctor", name: n, payloads: pat.elems.slice(1), pattern: pat };
    }
  }
  return { kind: "any" };
}

function isLowerStart(name: string): boolean {
  const c = name.charCodeAt(0);
  return c >= 97 && c <= 122;
}

function bindAnyPat(
  pat: Ast,
  v: Ast,
  body: Ast,
  guard: Ast | null,
): { body: Ast; guard: Ast | null } {
  if (pat.tag === "sym") {
    const n = headText(pat);
    if (n && n !== "_") {
      const wrap = (e: Ast): Ast => list("paren", [sym("let", pat.span), pat, v, e], pat.span);
      return { body: wrap(body), guard: guard ? wrap(guard) : null };
    }
  }
  return { body, guard };
}

function bindScrut(span: Ast["span"], scrut: Ast, v: Ast, body: Ast): Ast {
  const binding = list("paren", [sym("let", span), v, scrut], span);
  return list("paren", [sym("do", span), binding, body], span);
}

function boolLit(span: Ast["span"]): Ast {
  return { tag: "bool", value: true, span };
}

function emitMatch(span: Ast["span"], scrut: Ast, arms: { pat: Ast; body: Ast; guard: Ast | null }[]): Ast {
  const elems: Ast[] = [sym("match", span), scrut];
  for (const arm of arms) {
    const pat = arm.guard
      ? list("paren", [sym("guard", arm.pat.span), arm.pat, arm.guard], arm.pat.span)
      : arm.pat;
    elems.push(pat, arm.body);
  }
  return list("paren", elems, span);
}

function compileMulti(
  scruts: Ast[],
  arms: MArm[],
  fresh: (span: Ast["span"]) => Ast,
  span: Ast["span"],
): Ast {
  if (arms.length === 0) return list("paren", [], span);
  if (scruts.length === 0) return finishArms(arms, span);
  const scrut = scruts[0]!;
  const rest = scruts.slice(1);
  const kinds = arms.map((arm) => classifyPat(arm.pats[0]!));
  if (kinds.every((k) => k.kind === "any")) {
    const v = fresh(scrut.span);
    const next = arms.map((arm) => {
      const bound = bindAnyPat(arm.pats[0]!, v, arm.body, arm.guard);
      return { pats: arm.pats.slice(1), body: bound.body, guard: bound.guard };
    });
    const cont = rest.length === 0 ? finishArms(next, span) : compileMulti(rest, next, fresh, span);
    return bindScrut(span, scrut, v, cont);
  }
  const order: string[] = [];
  const payloadCount = new Map<string, number>();
  const sample = new Map<string, PatClass & { kind: "ctor" }>();
  for (const k of kinds) {
    if (k.kind !== "ctor") continue;
    if (!payloadCount.has(k.name)) {
      order.push(k.name);
      payloadCount.set(k.name, k.payloads.length);
      sample.set(k.name, k);
    }
  }
  const v = fresh(scrut.span);
  const branches: { pat: Ast; body: Ast; guard: Ast | null }[] = [];
  for (const name of order) {
    const count = payloadCount.get(name)!;
    const ctor = sample.get(name)!;
    const vars = Array.from({ length: count }, () => fresh(span));
    const outer =
      count === 0 ? ctor.pattern : list("paren", [ctor.pattern.tag === "list" ? ctor.pattern.elems[0]! : sym(name, span), ...vars], span);
    const inner = arms.flatMap((arm, i) => {
      const k = kinds[i]!;
      if (k.kind === "any") {
        const wilds = vars.map((vr) => sym("_", vr.span));
        const bound = bindAnyPat(arm.pats[0]!, v, arm.body, arm.guard);
        return [{ pats: [...wilds, ...arm.pats.slice(1)], body: bound.body, guard: bound.guard }];
      }
      if (k.name !== name) return [];
      return [{ pats: [...k.payloads, ...arm.pats.slice(1)], body: arm.body, guard: arm.guard }];
    });
    const covered = arms.some((arm, i) => {
      if (arm.guard) return false;
      const k = kinds[i]!;
      return k.kind === "any" || k.name === name;
    });
    branches.push({
      pat: outer,
      body: compileMulti([...vars, ...rest], inner, fresh, span),
      guard: covered ? null : boolLit(span),
    });
  }
  const anys = arms.filter((_, i) => kinds[i]!.kind === "any");
  const anyCovers = anys.some((arm) => {
    if (arm.guard) return false;
    return arm.pats.slice(1).every((p) => classifyPat(p).kind === "any");
  });
  if (anys.length > 0 && anyCovers) {
    const next = anys.map((arm) => {
      const bound = bindAnyPat(arm.pats[0]!, v, arm.body, arm.guard);
      return { pats: arm.pats.slice(1), body: bound.body, guard: bound.guard };
    });
    const body = rest.length === 0 ? finishArms(next, span) : compileMulti(rest, next, fresh, span);
    const covered = anys.some((arm) => !arm.guard);
    branches.push({ pat: sym("_", span), body, guard: covered ? null : boolLit(span) });
  }
  return bindScrut(span, scrut, v, emitMatch(span, v, branches));
}

function finishArms(arms: MArm[], span: Ast["span"]): Ast {
  if (arms.length === 1 && !arms[0]!.guard) return arms[0]!.body;
  return emitMatch(
    span,
    list("paren", [], span),
    arms.map((arm) => ({ pat: sym("_", span), body: arm.body, guard: arm.guard })),
  );
}
