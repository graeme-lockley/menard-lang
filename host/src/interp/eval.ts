import type { Ast } from "../reader/ast.ts";
import { nameEquals } from "../reader/ast.ts";
import type { Span } from "../reader/span.ts";
import {
  type Value,
  type Env,
  emptyEnv,
  envGet,
  envSet,
  vInt,
  vStr,
  vUnit,
  vBool,
  vVariant,
} from "./value.ts";
import {
  mapNew,
  mapSet,
  mapGet,
  mapHas,
  mapSize,
  mapKeys,
  sbNew,
  sbAppend,
  sbAppendByte,
  sbClear,
  sbToStr,
  sbTakeStr,
} from "../builtins/collections.ts";
import type { Host } from "../host/host.ts";
import { showValue, equalValue, compareValue, dumpValue } from "./derive.ts";

export class PanicError extends Error {
  constructor(
    message: string,
    readonly span?: Span,
  ) {
    super(message);
    this.name = "PanicError";
  }
}

export type EvalResult =
  | { ok: true; value: Value }
  | { ok: false; panic: { message: string; span?: Span } };

function symName(ast: Ast): string {
  if (ast.tag !== "sym") throw new PanicError("expected symbol", ast.span);
  return new TextDecoder().decode(ast.name);
}

export function evalProgram(
  forms: Ast[],
  host: Host,
): EvalResult {
  const env = emptyEnv();
  installBuiltins(env);
  try {
    // define types / functions first
    for (const f of forms) {
      defineTop(f, env);
    }
    let last: Value = vUnit();
    for (const f of forms) {
      if (isTopDef(f)) continue;
      last = evalExpr(f, env, host, null);
    }
    // if last form is defn-only file, try calling main
    const main = envGet(env, "main");
    if (main && main.tag === "fn") {
      last = applyFn(main, [], host, forms[forms.length - 1]?.span);
    }
    return { ok: true, value: last };
  } catch (e) {
    if (e instanceof PanicError) {
      return { ok: false, panic: { message: e.message, span: e.span } };
    }
    throw e;
  }
}

function isTopDef(ast: Ast): boolean {
  if (ast.tag !== "list" || ast.elems.length === 0) return false;
  const h = ast.elems[0]!;
  if (h.tag !== "sym") return false;
  return (
    nameEquals(h.name, "defn") ||
    nameEquals(h.name, "defrec") ||
    nameEquals(h.name, "variant") ||
    nameEquals(h.name, "alias")
  );
}

function defineTop(ast: Ast, env: Env): void {
  if (ast.tag !== "list" || ast.elems.length === 0) return;
  const hn = ast.elems[0]!;
  if (hn.tag !== "sym") return;
  if (nameEquals(hn.name, "defn")) {
    if (ast.tag === "list") defineDefn(ast, env);
    return;
  }
  if (nameEquals(hn.name, "variant")) {
    // (variant Name|(Name [a]) (Ctor …)…)
    for (let i = 2; i < ast.elems.length; i++) {
      const ce = ast.elems[i]!;
      if (ce.tag !== "list" || ce.elems.length < 1 || ce.elems[0]!.tag !== "sym") continue;
      const cname = symName(ce.elems[0]!);
      const arity = ce.elems.length - 1;
      envSet(env, cname, {
        tag: "fn",
        params: Array.from({ length: arity }, (_, j) => `p${j}`),
        body: { __variant: cname, arity },
        env,
      });
    }
    return;
  }
  if (nameEquals(hn.name, "defrec")) {
    const namePart = ast.elems[1]!;
    const name =
      namePart.tag === "sym"
        ? symName(namePart)
        : namePart.tag === "list"
          ? symName(namePart.elems[0]!)
          : null;
    if (!name) return;
    const fieldCount = Math.max(0, ast.elems.length - 2);
    envSet(env, name, {
      tag: "fn",
      params: Array.from({ length: fieldCount }, (_, j) => `f${j}`),
      body: { __record: name, arity: fieldCount },
      env,
    });
  }
}

function applyFn(
  fn: Value & { tag: "fn" },
  args: Value[],
  host: Host,
  span?: Span,
): Value {
  // synthetic constructors
  const body = fn.body as Ast[] | { __variant: string; arity: number } | { __record: string; arity: number };
  if (body && typeof body === "object" && !Array.isArray(body) && "__variant" in body) {
    if (args.length !== body.arity) {
      throw new PanicError(
        `arity mismatch: expected ${body.arity}, found ${args.length}`,
        span,
      );
    }
    return vVariant(body.__variant, args);
  }
  if (body && typeof body === "object" && !Array.isArray(body) && "__record" in body) {
    if (args.length !== body.arity) {
      throw new PanicError(
        `arity mismatch: expected ${body.arity}, found ${args.length}`,
        span,
      );
    }
    return { tag: "record", name: body.__record, fields: args };
  }
  if (args.length !== fn.params.length) {
    throw new PanicError(
      `arity mismatch: expected ${fn.params.length}, found ${args.length}`,
      span,
    );
  }
  const child = emptyEnv(fn.env);
  for (let i = 0; i < fn.params.length; i++) {
    envSet(child, fn.params[i]!, args[i]!);
  }
  const forms = body as Ast[];
  let last: Value = vUnit();
  for (const b of forms) {
    last = evalExpr(b, child, host, null);
  }
  return last;
}

function defineDefn(ast: Ast & { tag: "list" }, env: Env): void {
  // (defn name (p: T)* -> R body…) or (defn (name [a]) …)
  let name: string;
  let idx = 1;
  const namePart = ast.elems[1]!;
  if (namePart.tag === "sym") {
    name = symName(namePart);
    idx = 2;
  } else if (namePart.tag === "list") {
    name = symName(namePart.elems[0]!);
    idx = 2;
  } else {
    throw new PanicError("malformed defn", ast.span);
  }
  const params: string[] = [];
  while (idx < ast.elems.length) {
    const e = ast.elems[idx]!;
    if (e.tag === "sym" && nameEquals(e.name, "->")) {
      idx++;
      break;
    }
    if (e.tag === "list" && e.elems.length >= 1) {
      const pn = symName(e.elems[0]!);
      params.push(pn.endsWith(":") ? pn.slice(0, -1) : pn);
      idx++;
      continue;
    }
    break;
  }
  // skip return type
  idx++;
  const body = ast.elems.slice(idx);
  envSet(env, name, {
    tag: "fn",
    params,
    body,
    env,
  });
}

function evalExpr(
  ast: Ast,
  env: Env,
  host: Host,
  loop: { names: string[]; env: Env } | null,
): Value {
  switch (ast.tag) {
    case "int":
      return vInt(ast.value);
    case "float":
      return { tag: "float", value: ast.value };
    case "bool":
      return vBool(ast.value);
    case "str":
      return vStr(ast.bytes);
    case "sym": {
      const n = symName(ast);
      const v = envGet(env, n);
      if (!v) throw new PanicError(`unbound variable ${n}`, ast.span);
      return v;
    }
    case "list": {
      if (ast.kind === "bracket") {
        return {
          tag: "list",
          elems: ast.elems.map((e) => evalExpr(e, env, host, loop)),
        };
      }
      if (ast.elems.length === 0) return vUnit();
      const head = ast.elems[0]!;
      if (head.tag === "sym") {
        if (nameEquals(head.name, "if")) return evalIf(ast, env, host, loop);
        if (nameEquals(head.name, "let")) return evalLet(ast, env, host, loop);
        if (nameEquals(head.name, "do")) return evalDo(ast, env, host, loop);
        if (nameEquals(head.name, "loop")) return evalLoop(ast, env, host);
        if (nameEquals(head.name, "recur")) return evalRecur(ast, env, host, loop);
        if (nameEquals(head.name, "panic")) {
          const msg =
            ast.elems[1] !== undefined
              ? valueToPanicMsg(evalExpr(ast.elems[1], env, host, loop))
              : "panic";
          throw new PanicError(msg, ast.span);
        }
        if (nameEquals(head.name, "return")) {
          if (ast.elems[1]) return evalExpr(ast.elems[1], env, host, loop);
          return vUnit();
        }
        if (nameEquals(head.name, "match")) return evalMatch(ast, env, host, loop);
        if (nameEquals(head.name, "fn") || nameEquals(head.name, "lambda")) {
          return evalLambda(ast, env);
        }
        if (nameEquals(head.name, "quote")) {
          return quoteValue(ast.elems[1] ?? ast);
        }
        if (nameEquals(head.name, "set!")) {
          const r = evalExpr(ast.elems[1]!, env, host, loop);
          const v = evalExpr(ast.elems[2]!, env, host, loop);
          if (r.tag !== "ref") throw new PanicError("set! on non-ref", ast.span);
          r.cell.value = v;
          return vUnit();
        }
        if (nameEquals(head.name, "defrec") || nameEquals(head.name, "variant") || nameEquals(head.name, "alias") || nameEquals(head.name, "defn")) {
          return vUnit();
        }
      }
      // application
      const callee = evalExpr(head, env, host, loop);
      const args = ast.elems.slice(1).map((a) => evalExpr(a, env, host, loop));
      return apply(callee, args, host, ast.span);
    }
  }
}

function valueToPanicMsg(v: Value): string {
  if (v.tag === "str") return new TextDecoder().decode(v.bytes);
  return showValue(v);
}

function evalIf(
  ast: Ast & { tag: "list" },
  env: Env,
  host: Host,
  loop: { names: string[]; env: Env } | null,
): Value {
  const t = evalExpr(ast.elems[1]!, env, host, loop);
  if (t.tag !== "bool") throw new PanicError("if test not Bool", ast.elems[1]!.span);
  return t.value
    ? evalExpr(ast.elems[2]!, env, host, loop)
    : evalExpr(ast.elems[3]!, env, host, loop);
}

function evalLet(
  ast: Ast & { tag: "list" },
  env: Env,
  host: Host,
  loop: { names: string[]; env: Env } | null,
): Value {
  const name = symName(ast.elems[1]!);
  const val = evalExpr(ast.elems[2]!, env, host, loop);
  const child = emptyEnv(env);
  envSet(child, name, val);
  if (ast.elems.length === 3) return val;
  let last: Value = val;
  for (let i = 3; i < ast.elems.length; i++) {
    last = evalExpr(ast.elems[i]!, child, host, loop);
  }
  return last;
}

function evalDo(
  ast: Ast & { tag: "list" },
  env: Env,
  host: Host,
  loop: { names: string[]; env: Env } | null,
): Value {
  let last: Value = vUnit();
  let e = env;
  for (let i = 1; i < ast.elems.length; i++) {
    const form = ast.elems[i]!;
    if (
      form.tag === "list" &&
      form.elems[0] &&
      form.elems[0].tag === "sym" &&
      nameEquals(form.elems[0].name, "let") &&
      form.elems.length === 3
    ) {
      const n = symName(form.elems[1]!);
      const v = evalExpr(form.elems[2]!, e, host, loop);
      const child = emptyEnv(e);
      envSet(child, n, v);
      e = child;
      last = v;
      continue;
    }
    last = evalExpr(form, e, host, loop);
  }
  return last;
}

function evalLoop(ast: Ast & { tag: "list" }, env: Env, host: Host): Value {
  const bindings = ast.elems[1]!;
  const body = ast.elems[2]!;
  const child = emptyEnv(env);
  const names: string[] = [];
  if (bindings.tag === "list") {
    for (const b of bindings.elems) {
      if (b.tag === "list" && b.elems.length >= 2) {
        const n = symName(b.elems[0]!);
        names.push(n);
        envSet(child, n, evalExpr(b.elems[1]!, env, host, null));
      }
    }
  }
  const loop = { names, env: child };
  for (;;) {
    try {
      return evalExpr(body, child, host, loop);
    } catch (e) {
      if (e instanceof RecurSignal) {
        for (let i = 0; i < names.length; i++) {
          envSet(child, names[i]!, e.args[i] ?? vUnit());
        }
        continue;
      }
      throw e;
    }
  }
}

class RecurSignal {
  constructor(readonly args: Value[]) {}
}

function evalRecur(
  ast: Ast & { tag: "list" },
  env: Env,
  host: Host,
  loop: { names: string[]; env: Env } | null,
): Value {
  if (!loop) throw new PanicError("recur outside loop", ast.span);
  const args = ast.elems.slice(1).map((a) => evalExpr(a, env, host, loop));
  throw new RecurSignal(args);
}

function evalLambda(ast: Ast & { tag: "list" }, env: Env): Value {
  const paramsAst = ast.elems[1]!;
  const params: string[] = [];
  if (paramsAst.tag === "list") {
    for (const p of paramsAst.elems) params.push(symName(p));
  }
  return {
    tag: "fn",
    params,
    body: [ast.elems[2]!],
    env,
  };
}

function evalMatch(
  ast: Ast & { tag: "list" },
  env: Env,
  host: Host,
  loop: { names: string[]; env: Env } | null,
): Value {
  // (match e pat1 body1 pat2 body2 …)
  const scrut = evalExpr(ast.elems[1]!, env, host, loop);
  const rest = ast.elems.slice(2);
  for (let i = 0; i + 1 < rest.length; i += 2) {
    const pat = rest[i]!;
    const body = rest[i + 1]!;
    const child = emptyEnv(env);
    if (matchPat(pat, scrut, child)) {
      return evalExpr(body, child, host, loop);
    }
  }
  throw new PanicError("match: no clause matched", ast.span);
}

function matchPat(pat: Ast, v: Value, env: Env): boolean {
  if (pat.tag === "sym") {
    const n = symName(pat);
    if (n === "_") return true;
    // nullary ctor?
    if (v.tag === "variant" && v.ctor === n && v.payloads.length === 0) return true;
    envSet(env, n, v);
    return true;
  }
  if (pat.tag === "int") return v.tag === "int" && v.value === pat.value;
  if (pat.tag === "str") {
    return (
      v.tag === "str" &&
      v.bytes.length === pat.bytes.length &&
      v.bytes.every((b, i) => b === pat.bytes[i])
    );
  }
  if (pat.tag === "bool") return v.tag === "bool" && v.value === pat.value;
  if (pat.tag === "list" && pat.elems.length >= 1 && pat.elems[0]!.tag === "sym") {
    const cn = symName(pat.elems[0]!);
    if (v.tag === "variant" && v.ctor === cn) {
      if (v.payloads.length !== pat.elems.length - 1) return false;
      for (let i = 0; i < v.payloads.length; i++) {
        if (!matchPat(pat.elems[i + 1]!, v.payloads[i]!, env)) return false;
      }
      return true;
    }
    if (v.tag === "record" && v.name === cn) {
      if (v.fields.length !== pat.elems.length - 1) return false;
      for (let i = 0; i < v.fields.length; i++) {
        if (!matchPat(pat.elems[i + 1]!, v.fields[i]!, env)) return false;
      }
      return true;
    }
  }
  return false;
}

function quoteValue(ast: Ast): Value {
  switch (ast.tag) {
    case "int":
      return vInt(ast.value);
    case "float":
      return { tag: "float", value: ast.value };
    case "bool":
      return vBool(ast.value);
    case "str":
      return vStr(ast.bytes);
    case "sym":
      return { tag: "sym", name: ast.name };
    case "list":
      return {
        tag: "list",
        elems: ast.elems.map(quoteValue),
      };
  }
}

function apply(callee: Value, args: Value[], host: Host, span?: Span): Value {
  if (callee.tag === "fn") return applyFn(callee, args, host, span);
  if (callee.tag === "builtin") return applyBuiltin(callee.name, args, host, span);
  throw new PanicError("attempted to call non-function", span);
}

function installBuiltins(env: Env): void {
  const names = [
    "+", "-", "*", "/", "%", "<", ">", "<=", ">=",
    "f+", "f-", "f*", "f/",
    "show", "print", "=", "compare", "dump",
    "ref", "deref",
    "str-byte-length", "str-byte", "str-slice", "str-concat", "char->str",
    "map-new", "map-get", "map-set", "map-has", "map-size", "map-keys",
    "sb-new", "sb-append!", "sb-append-byte!", "sb-length", "sb-clear!", "sb-to-str", "sb-take-str!",
    "None", "Some", "Ok", "Err", "Nil", "Cons",
  ];
  for (const n of names) {
    envSet(env, n, { tag: "builtin", name: n });
  }
}

function applyBuiltin(
  name: string,
  args: Value[],
  host: Host,
  span?: Span,
): Value {
  const i63 = (n: bigint) => BigInt.asIntN(63, n);
  switch (name) {
    case "+":
      return vInt(i63((args[0] as { value: bigint }).value + (args[1] as { value: bigint }).value));
    case "-":
      return vInt(i63((args[0] as { value: bigint }).value - (args[1] as { value: bigint }).value));
    case "*":
      return vInt(i63((args[0] as { value: bigint }).value * (args[1] as { value: bigint }).value));
    case "/": {
      const d = (args[1] as { value: bigint }).value;
      if (d === 0n) throw new PanicError("division by zero", span);
      return vInt(i63((args[0] as { value: bigint }).value / d));
    }
    case "%": {
      const d = (args[1] as { value: bigint }).value;
      if (d === 0n) throw new PanicError("division by zero", span);
      return vInt(i63((args[0] as { value: bigint }).value % d));
    }
    case "<":
      return vBool((args[0] as { value: bigint }).value < (args[1] as { value: bigint }).value);
    case ">":
      return vBool((args[0] as { value: bigint }).value > (args[1] as { value: bigint }).value);
    case "<=":
      return vBool((args[0] as { value: bigint }).value <= (args[1] as { value: bigint }).value);
    case ">=":
      return vBool((args[0] as { value: bigint }).value >= (args[1] as { value: bigint }).value);
    case "show":
      return vStr(new TextEncoder().encode(showValue(args[0]!)));
    case "print": {
      const s = showValue(args[0]!);
      host.writeStdout(new TextEncoder().encode(s + "\n"));
      return vUnit();
    }
    case "=":
      return vBool(equalValue(args[0]!, args[1]!));
    case "compare":
      return vInt(BigInt(compareValue(args[0]!, args[1]!)));
    case "dump": {
      host.writeStderr(new TextEncoder().encode(dumpValue(args[0]!) + "\n"));
      return vUnit();
    }
    case "ref":
      return { tag: "ref", cell: { value: args[0]! } };
    case "deref": {
      const r = args[0]!;
      if (r.tag !== "ref") throw new PanicError("deref of non-ref", span);
      return r.cell.value;
    }
    case "str-byte-length":
      return vInt(BigInt((args[0] as { bytes: Uint8Array }).bytes.length));
    case "str-byte": {
      const s = args[0] as { bytes: Uint8Array };
      const i = Number((args[1] as { value: bigint }).value);
      return vInt(BigInt(s.bytes[i] ?? 0));
    }
    case "str-slice": {
      const s = args[0] as { bytes: Uint8Array };
      const start = Number((args[1] as { value: bigint }).value);
      const len = Number((args[2] as { value: bigint }).value);
      return vStr(s.bytes.slice(start, start + len));
    }
    case "str-concat": {
      const a = (args[0] as { bytes: Uint8Array }).bytes;
      const b = (args[1] as { bytes: Uint8Array }).bytes;
      const out = new Uint8Array(a.length + b.length);
      out.set(a);
      out.set(b, a.length);
      return vStr(out);
    }
    case "char->str": {
      // encode scalar as UTF-8
      const cp = (args[0] as { value: number }).value;
      return vStr(new TextEncoder().encode(String.fromCodePoint(cp)));
    }
    case "map-new":
      return { tag: "map", map: mapNew() };
    case "map-get": {
      const m = args[0] as { map: ReturnType<typeof mapNew> };
      const g = mapGet(m.map, args[1]!);
      return g === undefined ? vVariant("None") : vVariant("Some", [g]);
    }
    case "map-set": {
      const m = args[0] as { map: ReturnType<typeof mapNew> };
      return { tag: "map", map: mapSet(m.map, args[1]!, args[2]!) };
    }
    case "map-has": {
      const m = args[0] as { map: ReturnType<typeof mapNew> };
      return vBool(mapHas(m.map, args[1]!));
    }
    case "map-size": {
      const m = args[0] as { map: ReturnType<typeof mapNew> };
      return vInt(mapSize(m.map));
    }
    case "map-keys": {
      const m = args[0] as { map: ReturnType<typeof mapNew> };
      return { tag: "list", elems: mapKeys(m.map) };
    }
    case "sb-new":
      return { tag: "sb", sb: sbNew() };
    case "sb-append!": {
      const sb = args[0] as { sb: ReturnType<typeof sbNew> };
      sbAppend(sb.sb, (args[1] as { bytes: Uint8Array }).bytes);
      return vUnit();
    }
    case "sb-append-byte!": {
      const sb = args[0] as { sb: ReturnType<typeof sbNew> };
      sbAppendByte(sb.sb, Number((args[1] as { value: bigint }).value));
      return vUnit();
    }
    case "sb-length": {
      const sb = args[0] as { sb: ReturnType<typeof sbNew> };
      return vInt(BigInt(sb.sb.length));
    }
    case "sb-clear!": {
      const sb = args[0] as { sb: ReturnType<typeof sbNew> };
      sbClear(sb.sb);
      return vUnit();
    }
    case "sb-to-str": {
      const sb = args[0] as { sb: ReturnType<typeof sbNew> };
      return vStr(sbToStr(sb.sb).slice());
    }
    case "sb-take-str!": {
      const sb = args[0] as { sb: ReturnType<typeof sbNew> };
      return vStr(sbTakeStr(sb.sb));
    }
    case "None":
      return vVariant("None");
    case "Some":
      return vVariant("Some", [args[0]!]);
    case "Ok":
      return vVariant("Ok", [args[0]!]);
    case "Err":
      return vVariant("Err", [args[0]!]);
    case "Nil":
      return vVariant("Nil");
    case "Cons":
      return vVariant("Cons", [args[0]!, args[1]!]);
    default:
      throw new PanicError(`unknown builtin ${name}`, span);
  }
}
