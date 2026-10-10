import type { Ast } from "./ast.ts";
import { symName } from "./ast.ts";
import type { Span } from "./span.ts";
import { lex, type Tok } from "./lex.ts";

export type ParseErr = { span: Span; message: string };

type R = { ok: true; ast: Ast } | { ok: false; error: ParseErr };
type Rs = { ok: true; forms: Ast[] } | { ok: false; error: ParseErr };

function sym(name: string, span: Span): Ast {
  return { tag: "sym", name: symName(name), span };
}
function paren(elems: Ast[], span: Span): Ast {
  return { tag: "list", kind: "paren", elems, span };
}
function bracket(elems: Ast[], span: Span): Ast {
  return { tag: "list", kind: "bracket", elems, span };
}
function join(a: Span, b: Span): Span {
  return { start: a.start, end: b.end };
}

const PREC: Record<string, number> = {
  "?": 0,
  "|>": 1,
  "||": 2,
  "&&": 3,
  "==": 4,
  "!=": 4,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "::": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};
const CMP = new Set(["==", "!=", "<", ">", "<=", ">="]);

class P {
  i = 0;
  steps = 0;
  constructor(readonly toks: Tok[]) {}

  cur(): Tok {
    if (++this.steps > 2_000_000) throw new Error("parser did not advance");
    return this.toks[this.i] ?? this.toks[this.toks.length - 1]!;
  }
  at(k: TokKind | string, text?: string): boolean {
    const t = this.cur();
    if (text !== undefined) return t.text === text && (t.kind === k || k === t.kind);
    return t.kind === k || t.text === k;
  }
  eat(text: string): Tok | null {
    const t = this.cur();
    if (t.text !== text) return null;
    if ("(){}[],".includes(text) && t.kind !== "punct") return null;
    if ((text === "->" || text === "=" || text === "|" || text === "u-") && t.kind !== "op") return null;
    return this.toks[this.i++]!;
  }
  /** A real delimiter, not a string whose contents look like one. */
  delim(text: string): boolean {
    const t = this.cur();
    return t.kind === "punct" && t.text === text;
  }
  err(t: Tok, message: string): R {
    return { ok: false, error: { span: t.span, message } };
  }
  errEnd(message: string): R {
    const t = this.cur();
    return { ok: false, error: { span: t.span, message: message.includes("unclosed") ? message : message } };
  }

  parseFile(): Rs {
    const forms: Ast[] = [];
    while (this.cur().kind !== "eof") {
      if (this.cur().indent !== 0 || !this.cur().bol) {
        return { ok: false, error: { span: this.cur().span, message: "top-level declaration must start at column 0" } };
      }
      const t = this.cur();
      const decl =
        (t.kind === "kw" &&
          (t.text === "pub" ||
            t.text === "import" ||
            t.text === "extern" ||
            t.text === "alias" ||
            t.text === "record" ||
            t.text === "type" ||
            t.text === "let")) ||
        t.text === "runtime" ||
        t.text === "test";
      const f = decl ? this.parseDecl() : this.parseExpr();
      if (!f.ok) return f;
      forms.push(f.ast);
    }
    return { ok: true, forms };
  }

  parseOneExpr(): R {
    if (this.cur().kind === "eof") {
      return this.err(this.cur(), "expected an expression");
    }
    const e = this.parseExpr();
    if (!e.ok) return e;
    if (this.cur().kind !== "eof") return this.err(this.cur(), "unexpected trailing input");
    return e;
  }

  parseDecl(): R {
    const pub = this.eat("pub");
    if (pub && (this.cur().text === "extern" || this.cur().text === "import" || this.cur().text === "test")) {
      return this.err(this.cur(), "pub cannot prefix this declaration");
    }
    const t = this.cur();
    let inner: R;
    if (t.text === "import") inner = this.parseImport();
    else if (t.text === "extern") inner = this.parseExtern();
    else if (t.text === "runtime") inner = this.parseRuntime();
    else if (t.text === "alias") inner = this.parseAlias();
    else if (t.text === "record") inner = this.parseRecord();
    else if (t.text === "type") inner = this.parseTypeDecl();
    else if (t.text === "let") inner = this.parseLetDecl(t.indent);
    else if (t.text === "test") inner = this.parseTest();
    else return this.err(t, "expected a declaration");
    if (!inner.ok) return inner;
    if (!pub) return inner;
    return { ok: true, ast: paren([sym("pub", pub.span), ...((inner.ast.tag === "list" && inner.ast.elems) || [])], join(pub.span, inner.ast.span)) };
  }

  parseImport(): R {
    const kw = this.toks[this.i++]!;
    const t = this.cur();
    if (t.kind === "str" || t.kind === "ident") {
      this.i++;
      const path = t.kind === "str" ? strAst(t) : sym(t.text, t.span);
      const elems: Ast[] = [sym("import", kw.span), path];
      let end = t.span;
      // `as` is a name everywhere except immediately after an import path.
      if (this.cur().kind === "ident" && this.cur().text === "as") {
        this.i++;
        const alias = this.cur();
        if (alias.kind !== "ident") return this.err(alias, "expected a module name");
        this.i++;
        elems.push(sym(alias.text, alias.span));
        end = alias.span;
      }
      return { ok: true, ast: paren(elems, join(kw.span, end)) };
    }
    return this.err(t, "expected a module path");
  }

  parseExtern(): R {
    const kw = this.toks[this.i++]!;
    const name = this.cur();
    if (name.kind !== "ident") return this.err(name, "expected an extern name");
    this.i++;
    const tparams = this.parseTParamsOpt();
    if (!tparams.ok) return tparams;
    const params = this.parseParamList();
    if (!params.ok) return params;
    if (!this.eat("->")) return this.err(this.cur(), "expected ->");
    const ret = this.parseType();
    if (!ret.ok) return ret;
    const nameAst = tparams.ast
      ? paren([sym(name.text, name.span), tparams.ast], join(name.span, tparams.ast.span))
      : sym(name.text, name.span);
    const elems: Ast[] = [sym("extern", kw.span), nameAst, ...params.asts, sym("->", ret.ast.span), ret.ast];
    return { ok: true, ast: paren(elems, join(kw.span, ret.ast.span)) };
  }

  parseRuntime(): R {
    const kw = this.toks[this.i++]!;
    const name = this.cur();
    if (name.kind !== "ident") return this.err(name, "expected a runtime name");
    this.i++;
    const tparams = this.parseTParamsOpt();
    if (!tparams.ok) return tparams;
    const params = this.parseParamList();
    if (!params.ok) return params;
    if (!this.eat("->")) return this.err(this.cur(), "expected ->");
    const ret = this.parseType();
    if (!ret.ok) return ret;
    const nameAst = tparams.ast
      ? paren([sym(name.text, name.span), tparams.ast], join(name.span, tparams.ast.span))
      : sym(name.text, name.span);
    const elems: Ast[] = [sym("runtime", kw.span), nameAst, ...params.asts, sym("->", ret.ast.span), ret.ast];
    return { ok: true, ast: paren(elems, join(kw.span, ret.ast.span)) };
  }

  parseAlias(): R {
    const kw = this.toks[this.i++]!;
    const name = this.cur();
    if (name.kind !== "ident") return this.err(name, "expected an alias name");
    this.i++;
    if (!this.eat("=")) return this.err(this.cur(), "expected =");
    const ty = this.parseType();
    if (!ty.ok) return ty;
    return { ok: true, ast: paren([sym("alias", kw.span), sym(name.text, name.span), ty.ast], join(kw.span, ty.ast.span)) };
  }

  parseRecord(): R {
    const kw = this.toks[this.i++]!;
    const name = this.parseNameWithParams(true);
    if (!name.ok) return name;
    if (!this.eat("{")) return this.errEnd("unclosed {");
    const fields: Ast[] = [];
    while (!this.delim("}") && this.cur().kind !== "eof") {
      this.eat(",");
      if (this.delim("}")) break;
      const f = this.parseField();
      if (!f.ok) return f;
      fields.push(f.ast);
      this.eat(",");
    }
    const close = this.eat("}");
    if (!close) return this.errEnd("unclosed {");
    return {
      ok: true,
      ast: paren([sym("defrec", kw.span), name.ast, ...fields], join(kw.span, close.span)),
    };
  }

  parseTypeDecl(): R {
    const kw = this.toks[this.i++]!;
    const name = this.parseNameWithParams(true);
    if (!name.ok) return name;
    const eq = this.eat("=");
    if (!eq) return this.err(this.cur(), "expected =");
    const introIndent = kw.indent;
    const ctors: Ast[] = [];
    while (this.cur().kind === "op" && this.cur().text === "|" && this.cur().bol && this.cur().indent > introIndent) {
      this.i++;
      const c = this.parseCtor();
      if (!c.ok) return c;
      ctors.push(c.ast);
    }
    if (ctors.length === 0) {
      return { ok: true, ast: paren([sym("variant", kw.span), name.ast], join(kw.span, name.ast.span)) };
    }
    const end = ctors[ctors.length - 1]!.span;
    return { ok: true, ast: paren([sym("variant", kw.span), name.ast, ...ctors], join(kw.span, end)) };
  }

  parseCtor(): R {
    const name = this.cur();
    if (name.kind !== "ident") return this.err(name, "expected a constructor");
    this.i++;
    if (!this.delim("(")) {
      return { ok: true, ast: paren([sym(name.text, name.span)], name.span) };
    }
    this.i++;
    const args: Ast[] = [];
    while (!this.delim(")") && this.cur().kind !== "eof") {
      this.eat(",");
      if (this.delim(")")) break;
      const ty = this.parseType();
      if (!ty.ok) return ty;
      args.push(ty.ast);
      this.eat(",");
    }
    const close = this.eat(")");
    if (!close) return this.errEnd("unclosed (");
    return { ok: true, ast: paren([sym(name.text, name.span), ...args], join(name.span, close.span)) };
  }

  parseLetDecl(indent: number): R {
    const kw = this.toks[this.i++]!;
    const name = this.cur();
    if (name.kind !== "ident" && name.kind !== "kw") return this.err(name, "expected a name");
    if (name.kind === "kw") return this.err(name, "expected a name");
    this.i++;
    const tparams = this.parseTParamsOpt();
    if (!tparams.ok) return tparams;
    if (this.delim("(")) {
      const params = this.parseParamList();
      if (!params.ok) return params;
      if (!this.eat("->")) return this.err(this.cur(), "expected ->");
      const ret = this.parseType();
      if (!ret.ok) return ret;
      const body = this.parseBody();
      if (!body.ok) return body;
      if (indent > 0) {
        const fnParams = paren(params.asts.map(bareParam), name.span);
        const fnAst = paren([sym("fn", kw.span), fnParams, body.ast], join(kw.span, body.ast.span));
        return {
          ok: true,
          ast: paren([sym("let", kw.span), sym(name.text, name.span), fnAst], join(kw.span, body.ast.span)),
        };
      }
      const nameAst = tparams.ast
        ? paren([sym(name.text, name.span), tparams.ast], join(name.span, tparams.ast.span))
        : sym(name.text, name.span);
      return {
        ok: true,
        ast: paren(
          [sym("defn", kw.span), nameAst, ...params.asts, sym("->", ret.ast.span), ret.ast, body.ast],
          join(kw.span, body.ast.span),
        ),
      };
    }
    if (!this.eat("=")) return this.err(this.cur(), "expected =");
    const expr = this.parseExpr();
    if (!expr.ok) return expr;
    return { ok: true, ast: paren([sym("let", kw.span), sym(name.text, name.span), expr.ast], join(kw.span, expr.ast.span)) };
  }

  parseTest(): R {
    const kw = this.toks[this.i++]!;
    const s = this.cur();
    if (s.kind !== "str") return this.err(s, "expected a test description");
    this.i++;
    if (!this.eat("=")) return this.err(this.cur(), "expected =");
    const e = this.parseExpr();
    if (!e.ok) return e;
    return { ok: true, ast: paren([sym("test", kw.span), strAst(s), e.ast], join(kw.span, e.ast.span)) };
  }

  parseBody(): R {
    if (this.delim("{")) return this.parseBlock();
    if (!this.eat("=")) return this.err(this.cur(), "expected = or {");
    return this.parseExpr();
  }

  parseParamList(): { ok: true; asts: Ast[] } | { ok: false; error: ParseErr } {
    if (!this.eat("(")) return { ok: false, error: { span: this.cur().span, message: "expected (" } };
    const asts: Ast[] = [];
    while (!this.delim(")") && this.cur().kind !== "eof") {
      this.eat(",");
      if (this.delim(")")) break;
      const rest = this.cur().kind === "ident" && this.cur().text === "...";
      if (rest) this.i++;
      const name = this.cur();
      if (name.kind !== "ident") return { ok: false, error: { span: name.span, message: "expected a parameter name" } };
      this.i++;
      const bare = name.text.endsWith(":") ? name.text.slice(0, -1) : name.text;
      if (this.cur().text === ":") this.i++;
      const ty = this.parseType();
      if (!ty.ok) return ty;
      const elems = [sym(`${bare}:`, name.span), ty.ast];
      if (rest) elems.push(sym("...", name.span));
      asts.push(paren(elems, join(name.span, ty.ast.span)));
      this.eat(",");
    }
    if (!this.eat(")")) return { ok: false, error: { span: this.cur().span, message: "unclosed (" } };
    return { ok: true, asts };
  }

  parseField(): R {
    const name = this.cur();
    if (name.kind !== "ident") return this.err(name, "expected a field name");
    this.i++;
    const bare = name.text.endsWith(":") ? name.text.slice(0, -1) : name.text;
    if (this.cur().text === ":") this.i++;
    else if (!name.text.endsWith(":")) return this.err(this.cur(), "expected :");
    const ty = this.parseType();
    if (!ty.ok) return ty;
    return { ok: true, ast: paren([sym(`${bare}:`, name.span), ty.ast], join(name.span, ty.ast.span)) };
  }

  parseTParamsOpt(): { ok: true; ast: Ast | null } | { ok: false; error: ParseErr } {
    if (!this.delim("[")) return { ok: true, ast: null };
    const open = this.toks[this.i++]!;
    const ps: Ast[] = [];
    while (!this.delim("]") && this.cur().kind !== "eof") {
      this.eat(",");
      if (this.delim("]")) break;
      const n = this.cur();
      if (n.kind !== "ident") return { ok: false, error: { span: n.span, message: "expected a type parameter" } };
      this.i++;
      ps.push(sym(n.text, n.span));
      this.eat(",");
    }
    const close = this.eat("]");
    if (!close) return { ok: false, error: { span: this.cur().span, message: "unclosed [" } };
    return { ok: true, ast: bracket(ps, join(open.span, close.span)) };
  }

  parseNameWithParams(upper: boolean): R {
    void upper;
    const name = this.cur();
    if (name.kind !== "ident") return this.err(name, "expected a name");
    this.i++;
    const tp = this.parseTParamsOpt();
    if (!tp.ok) return tp;
    if (!tp.ast) return { ok: true, ast: sym(name.text, name.span) };
    return { ok: true, ast: paren([sym(name.text, name.span), tp.ast], join(name.span, tp.ast.span)) };
  }

  parseBlock(): R {
    const open = this.eat("{");
    if (!open) return this.err(this.cur(), "expected {");
    if (this.delim("}")) return this.finishMap(open, []);
    if (this.cur().kind === "eof") return this.errEnd("unclosed {");
    if (this.cur().kind === "ident" && this.cur().text === "...") return this.parseMapEntry(open, []);
    const first = this.parseStmt();
    if (!first.ok) return first;
    if (this.cur().kind === "op" && this.cur().text === "=>" && !this.isBlockStmt(first.ast)) {
      return this.parseMapPair(open, first.ast, []);
    }
    const elems: Ast[] = [sym("do", open.span), first.ast];
    while (!this.delim("}") && this.cur().kind !== "eof") {
      const e = this.parseStmt();
      if (!e.ok) return e;
      elems.push(e.ast);
    }
    const close = this.eat("}");
    if (!close) return this.errEnd("unclosed {");
    return { ok: true, ast: paren(elems, join(open.span, close.span)) };
  }

  isBlockStmt(ast: Ast): boolean {
    if (ast.tag !== "list" || ast.elems[0]?.tag !== "sym") return false;
    const n = new TextDecoder().decode(ast.elems[0].name);
    return n === "let" || n === "return";
  }

  parseMapPair(open: Tok, key: Ast, acc: Ast[]): R {
    const arrow = this.eat("=>");
    if (!arrow) return this.err(this.cur(), "expected =>");
    const val = this.parseExpr();
    if (!val.ok) return val;
    const entry = paren([sym("=>", arrow.span), key, val.ast], join(key.span, val.ast.span));
    return this.parseMapAfter(open, acc.concat([entry]));
  }

  parseMapEntry(open: Tok, acc: Ast[]): R {
    if (this.cur().kind === "ident" && this.cur().text === "...") {
      const dots = this.toks[this.i++]!;
      const expr = this.parseExpr();
      if (!expr.ok) return expr;
      const entry = paren([sym("...", dots.span), expr.ast], join(dots.span, expr.ast.span));
      return this.parseMapAfter(open, acc.concat([entry]));
    }
    const key = this.parseExpr();
    if (!key.ok) return key;
    return this.parseMapPair(open, key.ast, acc);
  }

  parseMapAfter(open: Tok, acc: Ast[]): R {
    if (this.delim("}")) return this.finishMap(open, acc);
    if (this.eat(",")) {
      if (this.delim("}")) return this.finishMap(open, acc);
      return this.parseMapEntry(open, acc);
    }
    return this.err(this.cur(), "expected , or }");
  }

  finishMap(open: Tok, entries: Ast[]): R {
    const close = this.eat("}");
    if (!close) return this.errEnd("unclosed {");
    return {
      ok: true,
      ast: paren([sym("map-lit", open.span), ...entries], join(open.span, close.span)),
    };
  }

  parseStmt(): R {
    if (this.cur().text === "let" && this.cur().bol) return this.parseLetDecl(this.cur().indent);
    if (this.cur().text === "return") {
      const kw = this.toks[this.i++]!;
      const e = this.parseExpr();
      if (!e.ok) return e;
      return { ok: true, ast: paren([sym("return", kw.span), e.ast], join(kw.span, e.ast.span)) };
    }
    return this.parseExpr();
  }

  parseExpr(): R {
    return this.parsePrec(0);
  }

  parsePrec(min: number): R {
    let left = this.parseUnary();
    if (!left.ok) return left;
    for (;;) {
      const op = this.cur();
      if (op.kind !== "op" || op.text === "->" || op.text === "u-" || op.text === "|") break;
      const p = PREC[op.text];
      if (p === undefined || p < min) break;
      if (CMP.has(op.text)) {
        const chain = this.parseCmpChain(left.ast, op.text);
        if (!chain.ok) return chain;
        left = chain;
        continue;
      }
      if (op.text === "&&" || op.text === "||") {
        const chain = this.parseLogicChain(left.ast, op.text);
        if (!chain.ok) return chain;
        left = chain;
        continue;
      }
      this.i++;
      const rightPrec = op.text === "::" || op.text === "?" ? p : p + 1;
      const right = this.parsePrec(rightPrec);
      if (!right.ok) return right;
      const core = op.text === "::" ? "Cons" : op.text;
      left = {
        ok: true,
        ast: paren([sym(core, op.span), left.ast, right.ast], join(left.ast.span, right.ast.span)),
      };
    }
    return left;
  }

  parseLogicChain(first: Ast, op: string, stops?: string[]): R {
    const core = op === "&&" ? "and" : "or";
    const args: Ast[] = [first];
    let span = first.span;
    const prec = PREC[op]!;
    while (this.cur().kind === "op" && this.cur().text === op && !(stops && stops.includes(op))) {
      this.i++;
      const right = stops ? this.parsePrecStop(prec + 1, stops) : this.parsePrec(prec + 1);
      if (!right.ok) return right;
      args.push(right.ast);
      span = join(span, right.ast.span);
    }
    return { ok: true, ast: paren([sym(core, span), ...args], span) };
  }

  parseCmpChain(first: Ast, op: string): R {
    const args: Ast[] = [first];
    let span = first.span;
    let curOp = op;
    while (this.cur().kind === "op" && this.cur().text === curOp && CMP.has(curOp)) {
      const ot = this.toks[this.i++]!;
      const right = this.parsePrec(PREC[curOp]! + 1);
      if (!right.ok) return right;
      args.push(right.ast);
      span = join(span, right.ast.span);
      void ot;
    }
    if (args.length === 2) {
      return { ok: true, ast: this.cmpPair(curOp, args[0]!, args[1]!, span) };
    }
    // a < b < c < d => (and (< a b) (< b c) (< c d))
    const pairs: Ast[] = [];
    for (let k = 1; k < args.length; k++) {
      pairs.push(this.cmpPair(curOp, args[k - 1]!, args[k]!, span));
    }
    return { ok: true, ast: paren([sym("and", span), ...pairs], span) };
  }

  cmpPair(op: string, a: Ast, b: Ast, span: Span): Ast {
    if (op === "==") return paren([sym("=", span), a, b], span);
    if (op === "!=") return paren([sym("not", span), paren([sym("=", span), a, b], span)], span);
    return paren([sym(op, span), a, b], span);
  }

  parseUnary(): R {
    if (this.cur().kind === "op" && this.cur().text === "u-") {
      const op = this.toks[this.i++]!;
      const e = this.parseUnary();
      if (!e.ok) return e;
      return { ok: true, ast: paren([sym("-", op.span), e.ast], join(op.span, e.ast.span)) };
    }
    return this.parsePost();
  }

  parsePost(): R {
    let left = this.parseAtom();
    if (!left.ok) return left;
    for (;;) {
      if (this.delim("(") && !this.cur().bol) {
        const call = this.parseCallArgs(left.ast);
        if (!call.ok) return call;
        left = call;
        continue;
      }
      if (this.cur().kind === "punct" && this.cur().text === "." && !this.cur().bol) {
        const projected = this.parseProject(left.ast);
        if (!projected.ok) return projected;
        left = projected;
        continue;
      }
      return left;
    }
  }

  parseProject(target: Ast): R {
    const dot = this.toks[this.i++]!;
    const field = this.cur();
    if (field.kind !== "ident") return this.err(field, "expected a field name");
    this.i++;
    return {
      ok: true,
      ast: paren(
        [sym("project", dot.span), target, sym(field.text, field.span)],
        join(target.span, field.span),
      ),
    };
  }

  parseCallArgs(callee: Ast): R {
    this.eat("(");
    const args: Ast[] = [callee];
    while (!this.delim(")") && this.cur().kind !== "eof") {
      this.eat(",");
      if (this.delim(")")) break;
      if (this.cur().kind === "ident" && this.cur().text === "...") {
        this.i++;
        args.push(sym("...", this.cur().span));
      }
      const e = this.parseExpr();
      if (!e.ok) return e;
      args.push(e.ast);
      this.eat(",");
    }
    const close = this.eat(")");
    if (!close) return this.errEnd("unclosed (");
    return { ok: true, ast: paren(args, join(callee.span, close.span)) };
  }

  parseAtom(): R {
    const t = this.cur();
    if (t.kind === "kw" && t.text === "if") return this.parseIf();
    if (t.kind === "kw" && t.text === "cond") return this.parseCond();
    if (t.kind === "kw" && t.text === "match") return this.parseMatch();
    if (t.kind === "kw" && t.text === "loop") return this.parseLoop();
    if (t.kind === "kw" && t.text === "while") return this.parseWhile();
    if (t.kind === "kw" && t.text === "fn") return this.parseFn();
    if (t.kind === "punct" && t.text === "{") return this.parseBlock();
    if (t.kind === "punct" && t.text === "[") return this.parseList();
    if (t.kind === "punct" && t.text === "(") {
      const open = this.toks[this.i++]!;
      if (this.delim(")")) {
        const c = this.toks[this.i++]!;
        return { ok: true, ast: paren([], join(open.span, c.span)) };
      }
      const e = this.parseExpr();
      if (!e.ok) return e;
      const close = this.eat(")");
      if (!close) return this.errEnd("unclosed (");
      return e;
    }
    if (t.kind === "int") {
      this.i++;
      let v = BigInt(t.text.startsWith("+") ? t.text.slice(1) : t.text);
      v = BigInt.asIntN(63, v);
      return { ok: true, ast: { tag: "int", value: v, span: t.span } };
    }
    if (t.kind === "float") {
      this.i++;
      const value = Number(t.text);
      if (!Number.isFinite(value)) return this.err(t, "invalid float");
      return { ok: true, ast: { tag: "float", value, span: t.span } };
    }
    if (t.kind === "str") {
      this.i++;
      return { ok: true, ast: strAst(t) };
    }
    if (t.kind === "sym") {
      this.i++;
      return { ok: true, ast: paren([sym("quote", t.span), sym(t.text, t.span)], t.span) };
    }
    if (t.kind === "char") {
      this.i++;
      const v = BigInt.asIntN(63, BigInt(t.text));
      return {
        ok: true,
        ast: paren([sym("char", t.span), { tag: "int", value: v, span: t.span }], t.span),
      };
    }
    if (t.kind === "ident" || (t.kind === "kw" && (t.text === "true" || t.text === "false"))) {
      this.i++;
      if (t.text === "true" || t.text === "false") {
        return { ok: true, ast: { tag: "bool", value: t.text === "true", span: t.span } };
      }
      return { ok: true, ast: sym(t.text, t.span) };
    }
    if (t.kind === "op" && t.text === "=>") return this.err(t, "=> is only valid in a map");
    if (t.text === "panic" || t.text === "ref" || t.text === "deref" || t.text === "set!" || t.text === "recur") {
      this.i++;
      return this.parseCallArgs(sym(t.text, t.span));
    }
    return this.err(t, "expected an expression");
  }

  parseIf(): R {
    const kw = this.toks[this.i++]!;
    if (this.cur().kind === "punct" && this.cur().text === "(") return this.parseInlineIf(kw);
    return this.err(this.cur(), "expected (");
  }

  parseInlineIf(kw: Tok): R {
    if (!this.eat("(")) return this.err(this.cur(), "expected (");
    const test = this.parseExpr();
    if (!test.ok) return test;
    if (!this.eat(")")) return this.errEnd("unclosed (");
    if (!this.eat("->")) return this.err(this.cur(), "expected ->");
    const body = this.parseExpr();
    if (!body.ok) return body;
    const unit = paren([], kw.span);
    if (this.cur().kind === "op" && this.cur().text === "|" && !this.cur().bol) {
      this.i++;
      const els = this.parseExpr();
      if (!els.ok) return els;
      return { ok: true, ast: paren([sym("if", kw.span), test.ast, body.ast, els.ast], join(kw.span, els.ast.span)) };
    }
    return { ok: true, ast: paren([sym("if", kw.span), test.ast, body.ast, unit], join(kw.span, body.ast.span)) };
  }

  parseCond(): R {
    const kw = this.toks[this.i++]!;
    const arms: { test: Ast | null; body: Ast }[] = [];
    while (this.cur().kind === "op" && this.cur().text === "|" && this.cur().bol && this.cur().indent > kw.indent) {
      this.i++;
      if (this.cur().text === "else") {
        this.i++;
        this.eat("->");
        const b = this.parseExpr();
        if (!b.ok) return b;
        arms.push({ test: null, body: b.ast });
        break;
      }
      const test = this.parseExprStop(["->"]);
      if (!test.ok) return test;
      if (!this.eat("->")) return this.err(this.cur(), "expected ->");
      const body = this.parseExpr();
      if (!body.ok) return body;
      arms.push({ test: test.ast, body: body.ast });
    }
    if (arms.length === 0) return this.err(this.cur(), "cond requires arms");
    return { ok: true, ast: nestIf(arms, kw.span) };
  }

  parseMatch(): R {
    const kw = this.toks[this.i++]!;
    if (!this.eat("(")) return this.err(this.cur(), "expected (");
    const scrut = this.parseExpr();
    if (!scrut.ok) return scrut;
    if (!this.eat(")")) return this.errEnd("unclosed (");
    const elems: Ast[] = [sym("match", kw.span), scrut.ast];
    let saw = false;
    while (this.cur().kind === "op" && this.cur().text === "|" && this.cur().bol && this.cur().indent > kw.indent) {
      this.i++;
      const pats = this.parseOrPattern();
      if (!pats.ok) return pats;
      if (this.cur().text === "when") {
        this.i++;
        const g = this.parseExprStop(["->"]);
        if (!g.ok) return g;
        if (!this.eat("->")) return this.err(this.cur(), "expected ->");
        const body = this.parseExpr();
        if (!body.ok) return body;
        const pat = paren([sym("guard", pats.asts[0]!.span), pats.asts[0]!, g.ast], pats.asts[0]!.span);
        elems.push(pat, body.ast);
        saw = true;
        continue;
      }
      if (!this.eat("->")) return this.err(this.cur(), "expected ->");
      const body = this.parseExpr();
      if (!body.ok) return body;
      for (const p of pats.asts) {
        elems.push(p, body.ast);
        saw = true;
      }
    }
    if (!saw) return this.err(this.cur(), "match requires arms");
    return { ok: true, ast: paren(elems, join(kw.span, elems[elems.length - 1]!.span)) };
  }

  parseOrPattern(): { ok: true; asts: Ast[] } | { ok: false; error: ParseErr } {
    const asts: Ast[] = [];
    for (;;) {
      const p = this.parsePattern();
      if (!p.ok) return p;
      asts.push(p.ast);
      if (this.cur().kind === "op" && this.cur().text === "|" && !this.cur().bol) {
        this.i++;
        continue;
      }
      break;
    }
    return { ok: true, asts };
  }

  parsePattern(): R {
    const left = this.parsePatternAtom();
    if (!left.ok) return left;
    if (this.cur().kind === "op" && this.cur().text === "::") {
      const op = this.toks[this.i++]!;
      const right = this.parsePattern();
      if (!right.ok) return right;
      return { ok: true, ast: paren([sym("Cons", op.span), left.ast, right.ast], join(left.ast.span, right.ast.span)) };
    }
    return left;
  }

  parsePatternAtom(): R {
    const t = this.cur();
    if (t.text === "_") {
      this.i++;
      return { ok: true, ast: sym("_", t.span) };
    }
    if (t.kind === "punct" && t.text === "[") return this.parseList();
    if (t.kind === "int" || t.kind === "str" || t.kind === "sym" || t.kind === "char" || t.text === "true" || t.text === "false") {
      return this.parseAtom();
    }
    if (t.kind === "ident") {
      this.i++;
      if (this.delim("(") && !this.cur().bol) {
        const call = this.parsePatternArgs(sym(t.text, t.span));
        if (!call.ok) return call;
        return call;
      }
      if (t.text[0]! >= "A" && t.text[0]! <= "Z") {
        return { ok: true, ast: paren([sym(t.text, t.span)], t.span) };
      }
      return { ok: true, ast: sym(t.text, t.span) };
    }
    return this.err(t, "expected a pattern");
  }

  parsePatternArgs(callee: Ast): R {
    this.eat("(");
    const args: Ast[] = [callee];
    while (!this.delim(")") && this.cur().kind !== "eof") {
      this.eat(",");
      if (this.delim(")")) break;
      const p = this.parsePattern();
      if (!p.ok) return p;
      args.push(p.ast);
      this.eat(",");
    }
    const close = this.eat(")");
    if (!close) return this.errEnd("unclosed (");
    return { ok: true, ast: paren(args, join(callee.span, close.span)) };
  }

  parseLoop(): R {
    const kw = this.toks[this.i++]!;
    if (!this.eat("(")) return this.err(this.cur(), "expected (");
    const binds: Ast[] = [];
    while (!this.delim(")") && this.cur().kind !== "eof") {
      this.eat(",");
      if (this.delim(")")) break;
      const n = this.cur();
      if (n.kind !== "ident") return this.err(n, "expected a loop binding");
      this.i++;
      if (!this.eat("=")) return this.err(this.cur(), "expected =");
      const e = this.parseExpr();
      if (!e.ok) return e;
      binds.push(paren([sym(n.text, n.span), e.ast], join(n.span, e.ast.span)));
      this.eat(",");
    }
    if (!this.eat(")")) return this.errEnd("unclosed (");
    const body = this.parseExpr();
    if (!body.ok) return body;
    return {
      ok: true,
      ast: paren([sym("loop", kw.span), paren(binds, kw.span), body.ast], join(kw.span, body.ast.span)),
    };
  }

  parseWhile(): R {
    const kw = this.toks[this.i++]!;
    if (!this.eat("(")) return this.err(this.cur(), "expected (");
    const test = this.parseExpr();
    if (!test.ok) return test;
    if (!this.eat(")")) return this.errEnd("unclosed (");
    const body = this.parseBlock();
    if (!body.ok) return body;
    const inner = body.ast.tag === "list" ? body.ast.elems.slice(1) : [body.ast];
    return {
      ok: true,
      ast: paren([sym("while", kw.span), test.ast, ...inner], join(kw.span, body.ast.span)),
    };
  }

  parseFn(): R {
    const kw = this.toks[this.i++]!;
    const params = this.parseFnParams();
    if (!params.ok) return params;
    let ret: Ast | null = null;
    if (this.cur().kind === "op" && this.cur().text === "->") {
      this.i++;
      const ty = this.parseType();
      if (!ty.ok) return ty;
      ret = ty.ast;
    }
    const body = this.parseBody();
    if (!body.ok) return body;
    // Annotated return type is not stored on core fn; the body is checked by inference.
    void ret;
    return {
      ok: true,
      ast: paren([sym("fn", kw.span), params.ast, body.ast], join(kw.span, body.ast.span)),
    };
  }

  parseFnParams(): R {
    if (!this.eat("(")) return this.err(this.cur(), "expected (");
    const ps: Ast[] = [];
    const openSpan = this.toks[this.i - 1]!.span;
    while (!this.delim(")") && this.cur().kind !== "eof") {
      this.eat(",");
      if (this.delim(")")) break;
      const n = this.cur();
      if (n.kind !== "ident") return this.err(n, "expected a parameter");
      this.i++;
      const bare = n.text.endsWith(":") ? n.text.slice(0, -1) : n.text;
      if (n.text.endsWith(":") || this.cur().text === ":") {
        if (this.cur().text === ":") this.i++;
        const ty = this.parseType();
        if (!ty.ok) return ty;
        void ty;
      }
      ps.push(sym(bare, n.span));
      this.eat(",");
    }
    const close = this.eat(")");
    if (!close) return this.errEnd("unclosed (");
    return { ok: true, ast: paren(ps, join(openSpan, close.span)) };
  }

  parseList(): R {
    const open = this.eat("[")!;
    const elems: Ast[] = [];
    while (!this.delim("]") && this.cur().kind !== "eof") {
      this.eat(",");
      if (this.delim("]")) break;
      const e = this.parseExpr();
      if (!e.ok) return e;
      elems.push(e.ast);
      this.eat(",");
    }
    const close = this.eat("]");
    if (!close) return this.errEnd("unclosed [");
    return { ok: true, ast: bracket(elems, join(open.span, close.span)) };
  }

  parseType(): R {
    return this.parseTypeArrow();
  }

  parseTypeArrow(): R {
    if (this.delim("(")) {
      const open = this.toks[this.i++]!;
      if (this.delim(")")) {
        this.i++;
        if (this.cur().kind !== "op" || this.cur().text !== "->") return this.err(this.cur(), "expected ->");
        this.i++;
        const ret = this.parseType();
        if (!ret.ok) return ret;
        return { ok: true, ast: paren([sym("Fn", open.span), sym("->", open.span), ret.ast], join(open.span, ret.ast.span)) };
      }
      const first = this.parseType();
      if (!first.ok) return first;
      if (this.delim(",")) {
        const ps = [first.ast];
        while (this.eat(",")) {
          if (this.delim(")")) break;
          const n = this.parseType();
          if (!n.ok) return n;
          ps.push(n.ast);
        }
        if (!this.eat(")")) return this.errEnd("unclosed (");
        if (!this.eat("->")) return this.err(this.cur(), "expected ->");
        const ret = this.parseType();
        if (!ret.ok) return ret;
        return {
          ok: true,
          ast: paren([sym("Fn", open.span), ...ps, sym("->", ret.ast.span), ret.ast], join(open.span, ret.ast.span)),
        };
      }
      if (!this.eat(")")) return this.errEnd("unclosed (");
      if (this.cur().kind === "op" && this.cur().text === "->") {
        this.i++;
        const ret = this.parseType();
        if (!ret.ok) return ret;
        return {
          ok: true,
          ast: paren([sym("Fn", open.span), first.ast, sym("->", ret.ast.span), ret.ast], join(open.span, ret.ast.span)),
        };
      }
      return first;
    }
    const spine = this.parseTypeSpine();
    if (!spine.ok) return spine;
    if (this.cur().kind === "op" && this.cur().text === "->") {
      this.i++;
      const ret = this.parseType();
      if (!ret.ok) return ret;
      const ps = flattenSpine(spine.ast);
      return {
        ok: true,
        ast: paren([sym("Fn", spine.ast.span), ...ps, sym("->", ret.ast.span), ret.ast], join(spine.ast.span, ret.ast.span)),
      };
    }
    return spine;
  }

  parseTypeSpine(): R {
    const head = this.parseTypeAtom();
    if (!head.ok) return head;
    const args: Ast[] = [];
    while (this.isTypeAtom()) {
      const next = this.cur();
      if (next.bol) break;
      const a = this.parseTypeAtom();
      if (!a.ok) return a;
      args.push(a.ast);
    }
    if (args.length === 0) return head;
    return { ok: true, ast: paren([head.ast, ...args], join(head.ast.span, args[args.length - 1]!.span)) };
  }

  isTypeAtom(): boolean {
    const t = this.cur();
    if (t.kind === "ident") return true;
    if (t.kind === "punct" && (t.text === "(" || t.text === "[")) return true;
    return false;
  }

  parseTypeAtom(): R {
    const t = this.cur();
    if (t.kind === "ident") {
      this.i++;
      return { ok: true, ast: sym(t.text, t.span) };
    }
    if (t.kind === "punct" && t.text === "(") return this.parseTypeArrow();
    return this.err(t, "expected a type");
  }

  /** Parse an expression that stops before a token text, without consuming it. */
  parseExprStop(stops: string[]): R {
    return this.parsePrecStop(0, stops);
  }

  parsePrecStop(min: number, stops: string[]): R {
    if (stops.includes(this.cur().text)) return this.err(this.cur(), "expected an expression");
    let left = this.parseUnaryStop(stops);
    if (!left.ok) return left;
    for (;;) {
      const op = this.cur();
      if (stops.includes(op.text)) break;
      if (op.kind !== "op" || op.text === "->" || op.text === "u-" || op.text === "|") break;
      const p = PREC[op.text];
      if (p === undefined || p < min) break;
      if (CMP.has(op.text)) {
        const chain = this.parseCmpChain(left.ast, op.text);
        if (!chain.ok) return chain;
        left = chain;
        continue;
      }
      if (op.text === "&&" || op.text === "||") {
        const chain = this.parseLogicChain(left.ast, op.text, stops);
        if (!chain.ok) return chain;
        left = chain;
        continue;
      }
      this.i++;
      const rightPrec = op.text === "::" || op.text === "?" ? p : p + 1;
      const right = this.parsePrecStop(rightPrec, stops);
      if (!right.ok) return right;
      const core = op.text === "::" ? "Cons" : op.text;
      left = {
        ok: true,
        ast: paren([sym(core, op.span), left.ast, right.ast], join(left.ast.span, right.ast.span)),
      };
    }
    return left;
  }

  parseUnaryStop(stops: string[]): R {
    if (stops.includes(this.cur().text)) return this.err(this.cur(), "expected an expression");
    if (this.cur().kind === "op" && this.cur().text === "u-") {
      const op = this.toks[this.i++]!;
      const e = this.parseUnaryStop(stops);
      if (!e.ok) return e;
      return { ok: true, ast: paren([sym("-", op.span), e.ast], join(op.span, e.ast.span)) };
    }
    return this.parsePost();
  }
}

type TokKind = Tok["kind"];

function bareParam(p: Ast): Ast {
  if (p.tag !== "list" || p.elems[0]?.tag !== "sym") return p;
  const raw = new TextDecoder().decode(p.elems[0].name);
  const bare = raw.endsWith(":") ? raw.slice(0, -1) : raw;
  return sym(bare, p.elems[0].span);
}

function strAst(t: Tok): Ast {
  return { tag: "str", bytes: Buffer.from(t.text, "latin1"), span: t.span };
}

function nestIf(arms: { test: Ast | null; body: Ast }[], span: Span): Ast {
  const unit = paren([], span);
  function go(i: number): Ast {
    const a = arms[i]!;
    if (a.test === null) return a.body;
    const elseAst = i + 1 < arms.length ? go(i + 1) : unit;
    return paren([sym("if", span), a.test, a.body, elseAst], span);
  }
  return go(0);
}

function flattenSpine(ast: Ast): Ast[] {
  return [ast];
}

export function parseProgram(src: Uint8Array): Rs {
  const lx = lex(src);
  if (!lx.ok) return lx;
  return new P(lx.toks).parseFile();
}

export function parseExpression(src: Uint8Array): R {
  const lx = lex(src);
  if (!lx.ok) return lx;
  return new P(lx.toks).parseOneExpr();
}
