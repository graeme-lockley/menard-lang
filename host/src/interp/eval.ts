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
import { ExitSignal, type IoError } from "../host/host.ts";
import { showValue, equalValue, compareValue, dumpValue } from "./derive.ts";
import { decodeSymBytes, specialFormOf, Sf } from "./resolve.ts";

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
  | { ok: true; value: Value; exitCode?: number; env: Env }
  | { ok: false; panic: { message: string; span?: Span } };

function symName(ast: Ast): string {
  if (ast.tag !== "sym") throw new PanicError("expected symbol", ast.span);
  return decodeSymBytes(ast.name);
}

export function evalProgram(
  forms: Ast[],
  host: Host,
  opts: { importBindings?: Map<string, Value> } = {},
): EvalResult {
  const env = emptyEnv();
  installBuiltins(env);
  if (opts.importBindings) {
    for (const [k, v] of opts.importBindings) {
      envSet(env, k, v);
    }
  }
  try {
    for (const f of forms) {
      defineTop(f, env);
    }
    let last: Value = vUnit();
    let e = env;
    for (const f of forms) {
      if (isTopDef(f)) continue;
      if (
        f.tag === "list" &&
        f.elems[0]?.tag === "sym" &&
        nameEquals(f.elems[0].name, "let") &&
        f.elems.length === 3
      ) {
        const n = symName(f.elems[1]!);
        const v = evalExpr(f.elems[2]!, e, host);
        const child = emptyEnv(e);
        envSet(child, n, v);
        e = child;
        last = v;
        continue;
      }
      last = evalExpr(f, e, host);
    }
    const main = envGet(env, "main");
    if (main && main.tag === "fn") {
      last = applyFn(main, [], host, forms[forms.length - 1]?.span);
    }
    return { ok: true, value: last, env };
  } catch (err) {
    if (err instanceof ExitSignal) {
      return { ok: true, value: vUnit(), exitCode: err.code, env };
    }
    if (err instanceof PanicError) {
      return { ok: false, panic: { message: err.message, span: err.span } };
    }
    throw err;
  }
}

function isTopDef(ast: Ast): boolean {
  if (ast.tag !== "list" || ast.elems.length === 0) return false;
  const h = ast.elems[0]!;
  if (h.tag !== "sym") return false;
  if (nameEquals(h.name, "pub") && ast.elems.length >= 2) {
    return isTopDef({
      tag: "list",
      kind: ast.kind,
      elems: ast.elems.slice(1),
      span: ast.span,
    });
  }
  return (
    nameEquals(h.name, "defn") ||
    nameEquals(h.name, "defrec") ||
    nameEquals(h.name, "variant") ||
    nameEquals(h.name, "alias") ||
    nameEquals(h.name, "extern")
  );
}

function defineTop(ast: Ast, env: Env): void {
  if (ast.tag !== "list" || ast.elems.length === 0) return;
  const hn = ast.elems[0]!;
  if (hn.tag !== "sym") return;
  if (nameEquals(hn.name, "pub") && ast.elems.length >= 2) {
    defineTop(
      { tag: "list", kind: ast.kind, elems: ast.elems.slice(1), span: ast.span },
      env,
    );
    return;
  }
  if (nameEquals(hn.name, "extern")) {
    // Interpreter: extern names the existing host builtin (same symbol).
    const name = symName(ast.elems[1]!);
    const existing = envGet(env, name);
    if (!existing) {
      throw new PanicError(`extern unbound in interpreter: ${name}`, ast.span);
    }
    envSet(env, name, existing);
    return;
  }
  if (nameEquals(hn.name, "defn")) {
    defineDefn(ast, env);
    return;
  }
  if (nameEquals(hn.name, "variant")) {
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

function defineDefn(ast: Ast & { tag: "list" }, env: Env): void {
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
  idx++;
  const body = ast.elems.slice(idx);
  envSet(env, name, { tag: "fn", params, body, env });
}

type LoopCtx = { names: string[]; env: Env };

/**
 * Heap-allocated continuations. Menard recursion depth is bounded by this
 * stack (and memory), not by the JavaScript call stack (§3.5, §3.9).
 */
type Cont =
  | { tag: "seq"; forms: Ast[]; i: number; env: Env; loop: LoopCtx | null }
  | { tag: "if"; then: Ast; else_: Ast; env: Env; loop: LoopCtx | null }
  | { tag: "let"; name: string; rest: Ast[]; env: Env; loop: LoopCtx | null }
  | {
      tag: "list";
      elems: Ast[];
      i: number;
      acc: Value[];
      env: Env;
      loop: LoopCtx | null;
    }
  | {
      tag: "app";
      elems: Ast[];
      /** index of current arg being evaluated; -1 = evaluating callee (elems[0]) */
      i: number;
      callee: Value | null;
      argVals: Value[];
      env: Env;
      loop: LoopCtx | null;
      span?: Span;
    }
  | { tag: "set-ref"; valAst: Ast; env: Env; loop: LoopCtx | null; span?: Span }
  | { tag: "set-val"; ref: Value; span?: Span }
  | { tag: "match"; clauses: Ast[]; env: Env; loop: LoopCtx | null; span?: Span }
  | {
      tag: "loop-init";
      names: string[];
      inits: Ast[];
      i: number;
      child: Env;
      body: Ast;
      outer: Env;
    }
  | { tag: "loop-run"; names: string[]; child: Env; body: Ast }
  | {
      tag: "recur";
      argAsts: Ast[];
      i: number;
      vals: Value[];
      env: Env;
      loop: LoopCtx;
      span?: Span;
    }
  | { tag: "panic"; span?: Span };

type Step =
  | { tag: "value"; value: Value }
  | { tag: "eval"; ast: Ast; env: Env; loop: LoopCtx | null };

function evalExpr(ast: Ast, env: Env, host: Host): Value {
  return drive(ast, env, null, [], host);
}

function applyFn(
  fn: Value & { tag: "fn" },
  args: Value[],
  host: Host,
  span?: Span,
): Value {
  const opened = openFn(fn, args, span);
  if (opened.tag === "value") return opened.value;
  return driveSequence(opened.forms, opened.env, null, host);
}

function openFn(
  fn: Value & { tag: "fn" },
  args: Value[],
  span?: Span,
): { tag: "value"; value: Value } | { tag: "body"; forms: Ast[]; env: Env } {
  const body = fn.body as
    | Ast[]
    | { __variant: string; arity: number }
    | { __record: string; arity: number };
  if (body && typeof body === "object" && !Array.isArray(body) && "__variant" in body) {
    if (args.length !== body.arity) {
      throw new PanicError(
        `arity mismatch: expected ${body.arity}, found ${args.length}`,
        span,
      );
    }
    return { tag: "value", value: vVariant(body.__variant, args) };
  }
  if (body && typeof body === "object" && !Array.isArray(body) && "__record" in body) {
    if (args.length !== body.arity) {
      throw new PanicError(
        `arity mismatch: expected ${body.arity}, found ${args.length}`,
        span,
      );
    }
    return {
      tag: "value",
      value: { tag: "record", name: body.__record, fields: args },
    };
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
  return { tag: "body", forms: body as Ast[], env: child };
}

function driveSequence(
  forms: Ast[],
  env: Env,
  loop: LoopCtx | null,
  host: Host,
): Value {
  if (forms.length === 0) return vUnit();
  const stack: Cont[] = [];
  if (forms.length > 1) {
    stack.push({ tag: "seq", forms, i: 0, env, loop });
  }
  return drive(forms[0]!, env, loop, stack, host);
}

function drive(
  start: Ast,
  startEnv: Env,
  startLoop: LoopCtx | null,
  stack: Cont[],
  host: Host,
): Value {
  let pending: Ast | null = start;
  let env = startEnv;
  let loop = startLoop;
  let result: Value = vUnit();

  for (;;) {
    if (pending !== null) {
      const ast = pending;
      pending = null;
      const step = beginEval(ast, env, loop, stack);
      if (step.tag === "value") {
        result = step.value;
      } else {
        pending = step.ast;
        env = step.env;
        loop = step.loop;
        continue;
      }
    }

    for (;;) {
      if (stack.length === 0) return result;
      const c = stack.pop()!;
      const next = resume(c, result, stack, host);
      if (next.tag === "value") {
        result = next.value;
        continue;
      }
      pending = next.ast;
      env = next.env;
      loop = next.loop;
      break;
    }
  }
}

function beginEval(
  ast: Ast,
  env: Env,
  loop: LoopCtx | null,
  stack: Cont[],
): Step {
  switch (ast.tag) {
    case "int":
      return { tag: "value", value: vInt(ast.value) };
    case "float":
      return { tag: "value", value: { tag: "float", value: ast.value } };
    case "bool":
      return { tag: "value", value: vBool(ast.value) };
    case "str":
      return { tag: "value", value: vStr(ast.bytes) };
    case "sym": {
      const n = symName(ast);
      const v = envGet(env, n);
      if (!v) throw new PanicError(`unbound variable ${n}`, ast.span);
      return { tag: "value", value: v };
    }
    case "list": {
      if (ast.kind === "bracket") {
        if (ast.elems.length === 0) {
          return { tag: "value", value: { tag: "list", elems: [] } };
        }
        stack.push({
          tag: "list",
          elems: ast.elems,
          i: 0,
          acc: [],
          env,
          loop,
        });
        return { tag: "eval", ast: ast.elems[0]!, env, loop };
      }
      if (ast.elems.length === 0) return { tag: "value", value: vUnit() };
      const head = ast.elems[0]!;
      if (head.tag === "sym") {
        switch (specialFormOf(head.name)) {
          case Sf.If: {
            stack.push({
              tag: "if",
              then: ast.elems[2]!,
              else_: ast.elems[3]!,
              env,
              loop,
            });
            return { tag: "eval", ast: ast.elems[1]!, env, loop };
          }
          case Sf.Let: {
            const name = symName(ast.elems[1]!);
            stack.push({
              tag: "let",
              name,
              rest: ast.elems.length > 3 ? ast.elems.slice(3) : EMPTY_AST,
              env,
              loop,
            });
            return { tag: "eval", ast: ast.elems[2]!, env, loop };
          }
          case Sf.Do: {
            const forms = ast.elems.slice(1);
            if (forms.length === 0) return { tag: "value", value: vUnit() };
            if (forms.length > 1) {
              stack.push({ tag: "seq", forms, i: 0, env, loop });
            }
            return { tag: "eval", ast: forms[0]!, env, loop };
          }
          case Sf.Loop:
            return beginLoop(ast, env, stack);
          case Sf.Recur: {
            if (!loop) throw new PanicError("recur outside loop", ast.span);
            const argAsts = ast.elems.slice(1);
            if (argAsts.length === 0) {
              return restartLoop(stack, [], ast.span);
            }
            stack.push({
              tag: "recur",
              argAsts,
              i: 0,
              vals: [],
              env,
              loop,
              span: ast.span,
            });
            return { tag: "eval", ast: argAsts[0]!, env, loop };
          }
          case Sf.Panic: {
            if (ast.elems[1] === undefined) {
              throw new PanicError("panic", ast.span);
            }
            stack.push({ tag: "panic", span: ast.span });
            return { tag: "eval", ast: ast.elems[1]!, env, loop };
          }
          case Sf.Return:
            if (ast.elems[1]) return { tag: "eval", ast: ast.elems[1]!, env, loop };
            return { tag: "value", value: vUnit() };
          case Sf.Match: {
            stack.push({
              tag: "match",
              clauses: ast.elems.slice(2),
              env,
              loop,
              span: ast.span,
            });
            return { tag: "eval", ast: ast.elems[1]!, env, loop };
          }
          case Sf.Fn:
            return { tag: "value", value: evalLambda(ast, env) };
          case Sf.Quote:
            return { tag: "value", value: quoteValue(ast.elems[1] ?? ast) };
          case Sf.Set: {
            stack.push({
              tag: "set-ref",
              valAst: ast.elems[2]!,
              env,
              loop,
              span: ast.span,
            });
            return { tag: "eval", ast: ast.elems[1]!, env, loop };
          }
          case Sf.Decl:
            return { tag: "value", value: vUnit() };
          default:
            break;
        }
      }
      stack.push({
        tag: "app",
        elems: ast.elems,
        i: -1,
        callee: null,
        argVals: [],
        env,
        loop,
        span: ast.span,
      });
      return { tag: "eval", ast: head, env, loop };
    }
  }
}

const EMPTY_AST: Ast[] = [];

function beginLoop(ast: Ast & { tag: "list" }, env: Env, stack: Cont[]): Step {
  const bindings = ast.elems[1]!;
  const body = ast.elems[2]!;
  const child = emptyEnv(env);
  const names: string[] = [];
  const inits: Ast[] = [];
  if (bindings.tag === "list") {
    for (const b of bindings.elems) {
      if (b.tag === "list" && b.elems.length >= 2) {
        names.push(symName(b.elems[0]!));
        inits.push(b.elems[1]!);
      }
    }
  }
  if (inits.length === 0) {
    stack.push({ tag: "loop-run", names, child, body });
    return {
      tag: "eval",
      ast: body,
      env: child,
      loop: { names, env: child },
    };
  }
  stack.push({
    tag: "loop-init",
    names,
    inits,
    i: 0,
    child,
    body,
    outer: env,
  });
  return { tag: "eval", ast: inits[0]!, env, loop: null };
}

function resume(c: Cont, value: Value, stack: Cont[], host: Host): Step {
  switch (c.tag) {
    case "seq": {
      // Finished forms[c.i]. Binding-style (let x e) extends the sequence env.
      let e = c.env;
      const finished = c.forms[c.i]!;
      if (
        finished.tag === "list" &&
        finished.elems[0]?.tag === "sym" &&
        specialFormOf(finished.elems[0].name) === Sf.Let &&
        finished.elems.length === 3
      ) {
        const child = emptyEnv(e);
        envSet(child, symName(finished.elems[1]!), value);
        e = child;
      }
      const nextI = c.i + 1;
      if (nextI >= c.forms.length) return { tag: "value", value };
      if (nextI + 1 < c.forms.length) {
        stack.push({ tag: "seq", forms: c.forms, i: nextI, env: e, loop: c.loop });
      }
      return {
        tag: "eval",
        ast: c.forms[nextI]!,
        env: e,
        loop: c.loop,
      };
    }
    case "if": {
      if (value.tag !== "bool") throw new PanicError("if test not Bool");
      return {
        tag: "eval",
        ast: value.value ? c.then : c.else_,
        env: c.env,
        loop: c.loop,
      };
    }
    case "let": {
      const child = emptyEnv(c.env);
      envSet(child, c.name, value);
      if (c.rest.length === 0) return { tag: "value", value };
      if (c.rest.length === 1) {
        return { tag: "eval", ast: c.rest[0]!, env: child, loop: c.loop };
      }
      stack.push({ tag: "seq", forms: c.rest, i: 0, env: child, loop: c.loop });
      return { tag: "eval", ast: c.rest[0]!, env: child, loop: c.loop };
    }
    case "list": {
      const acc = c.acc;
      acc.push(value);
      const nextI = c.i + 1;
      if (nextI >= c.elems.length) {
        return { tag: "value", value: { tag: "list", elems: acc } };
      }
      stack.push({ ...c, i: nextI, acc });
      return { tag: "eval", ast: c.elems[nextI]!, env: c.env, loop: c.loop };
    }
    case "app": {
      if (c.i === -1) {
        // just got callee; args are elems[1..]
        if (c.elems.length <= 1) {
          return applyNow(value, [], host, c.span, stack, c.loop);
        }
        stack.push({
          tag: "app",
          elems: c.elems,
          i: 1,
          callee: value,
          argVals: [],
          env: c.env,
          loop: c.loop,
          span: c.span,
        });
        return { tag: "eval", ast: c.elems[1]!, env: c.env, loop: c.loop };
      }
      const argVals = c.argVals;
      argVals.push(value);
      const nextI = c.i + 1;
      if (nextI >= c.elems.length) {
        return applyNow(c.callee!, argVals, host, c.span, stack, c.loop);
      }
      stack.push({ ...c, i: nextI, argVals });
      return { tag: "eval", ast: c.elems[nextI]!, env: c.env, loop: c.loop };
    }
    case "set-ref": {
      stack.push({ tag: "set-val", ref: value, span: c.span });
      return { tag: "eval", ast: c.valAst, env: c.env, loop: c.loop };
    }
    case "set-val": {
      if (c.ref.tag !== "ref") throw new PanicError("set! on non-ref", c.span);
      c.ref.cell.value = value;
      return { tag: "value", value: vUnit() };
    }
    case "match": {
      for (let i = 0; i + 1 < c.clauses.length; i += 2) {
        const pat = c.clauses[i]!;
        const body = c.clauses[i + 1]!;
        const child = emptyEnv(c.env);
        if (matchPat(pat, value, child)) {
          return { tag: "eval", ast: body, env: child, loop: c.loop };
        }
      }
      throw new PanicError("match: no clause matched", c.span);
    }
    case "loop-init": {
      envSet(c.child, c.names[c.i]!, value);
      const nextI = c.i + 1;
      if (nextI >= c.inits.length) {
        stack.push({
          tag: "loop-run",
          names: c.names,
          child: c.child,
          body: c.body,
        });
        return {
          tag: "eval",
          ast: c.body,
          env: c.child,
          loop: { names: c.names, env: c.child },
        };
      }
      stack.push({ ...c, i: nextI });
      return { tag: "eval", ast: c.inits[nextI]!, env: c.outer, loop: null };
    }
    case "loop-run":
      return { tag: "value", value };
    case "recur": {
      const vals = c.vals;
      vals.push(value);
      const nextI = c.i + 1;
      if (nextI < c.argAsts.length) {
        stack.push({ ...c, i: nextI, vals });
        return {
          tag: "eval",
          ast: c.argAsts[nextI]!,
          env: c.env,
          loop: c.loop,
        };
      }
      return restartLoop(stack, vals, c.span);
    }
    case "panic":
      throw new PanicError(valueToPanicMsg(value), c.span);
  }
}

function applyNow(
  callee: Value,
  args: Value[],
  host: Host,
  span: Span | undefined,
  stack: Cont[],
  loop: LoopCtx | null,
): Step {
  if (callee.tag === "builtin") {
    return { tag: "value", value: applyBuiltin(callee.name, args, host, span) };
  }
  if (callee.tag !== "fn") {
    throw new PanicError("attempted to call non-function", span);
  }
  const opened = openFn(callee, args, span);
  if (opened.tag === "value") return opened;
  const forms = opened.forms;
  if (forms.length === 0) return { tag: "value", value: vUnit() };
  if (forms.length > 1) {
    stack.push({ tag: "seq", forms, i: 0, env: opened.env, loop });
  }
  return { tag: "eval", ast: forms[0]!, env: opened.env, loop };
}

function restartLoop(stack: Cont[], args: Value[], span?: Span): Step {
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.tag === "loop-run") break;
    stack.pop();
  }
  const top = stack[stack.length - 1];
  if (!top || top.tag !== "loop-run") {
    throw new PanicError("recur outside loop", span);
  }
  for (let i = 0; i < top.names.length; i++) {
    envSet(top.child, top.names[i]!, args[i] ?? vUnit());
  }
  return {
    tag: "eval",
    ast: top.body,
    env: top.child,
    loop: { names: top.names, env: top.child },
  };
}

function valueToPanicMsg(v: Value): string {
  if (v.tag === "str") return new TextDecoder().decode(v.bytes);
  return showValue(v);
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

function matchPat(pat: Ast, v: Value, env: Env): boolean {
  if (pat.tag === "sym") {
    const n = symName(pat);
    if (n === "_") return true;
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
      return { tag: "list", elems: ast.elems.map(quoteValue) };
  }
}

function installBuiltins(env: Env): void {
  const names = [
    "+", "-", "*", "/", "%", "<", ">", "<=", ">=",
    "f+", "f-", "f*", "f/",
    "show", "print", "println", "=", "compare", "dump",
    "ref", "deref",
    "str-byte-length", "str-byte", "str-slice", "str-concat", "char->str",
    "map-new", "map-get", "map-set", "map-has", "map-size", "map-keys",
    "sb-new", "sb-append!", "sb-append-byte!", "sb-length", "sb-clear!", "sb-to-str", "sb-take-str!",
    "None", "Some", "Ok", "Err", "Nil", "Cons",
    "exit", "arg-count", "arg", "write", "read-file", "write-file",
    "NotFound", "Permission", "Exists", "IsADirectory", "NotADirectory",
    "InvalidPath", "TooLarge", "Other", "Unsupported",
  ];
  for (const n of names) {
    envSet(env, n, { tag: "builtin", name: n });
  }
}

function ioErrorToValue(err: IoError): Value {
  switch (err.tag) {
    case "Other":
      return vVariant("Other", [vInt(err.code)]);
    case "Unsupported":
      // Not in the Menard IoError variant; fold into Other.
      return vVariant("Other", [vInt(0n)]);
    default:
      return vVariant(err.tag);
  }
}

function resultOk(v: Value): Value {
  return vVariant("Ok", [v]);
}

function resultErr(err: IoError): Value {
  return vVariant("Err", [ioErrorToValue(err)]);
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
      const enc = new TextEncoder();
      for (const a of args) {
        if (a.tag === "str") host.writeStdout(a.bytes);
        else host.writeStdout(enc.encode(showValue(a)));
      }
      return vUnit();
    }
    case "println": {
      const enc = new TextEncoder();
      for (const a of args) {
        if (a.tag === "str") host.writeStdout(a.bytes);
        else host.writeStdout(enc.encode(showValue(a)));
      }
      host.writeStdout(new Uint8Array([0x0a]));
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
    case "exit": {
      const code = Number((args[0] as { value: bigint }).value);
      return host.exit(code);
    }
    case "arg-count":
      return vInt(BigInt(host.argv.length));
    case "arg": {
      const i = Number((args[0] as { value: bigint }).value);
      if (i < 0 || i >= host.argv.length) {
        throw new PanicError(`arg index out of range: ${i}`, span);
      }
      return vStr(new TextEncoder().encode(host.argv[i]!));
    }
    case "write": {
      const fd = Number((args[0] as { value: bigint }).value);
      const s = args[1] as { bytes: Uint8Array };
      const w = host.writeFd(fd, s.bytes);
      return w.ok ? resultOk(vUnit()) : resultErr(w.error);
    }
    case "read-file": {
      const path = new TextDecoder().decode((args[0] as { bytes: Uint8Array }).bytes);
      const r = host.readFile(path);
      return r.ok ? resultOk(vStr(r.bytes)) : resultErr(r.error);
    }
    case "write-file": {
      const path = new TextDecoder().decode((args[0] as { bytes: Uint8Array }).bytes);
      const data = (args[1] as { bytes: Uint8Array }).bytes;
      const w = host.writeFile(path, data);
      return w.ok ? resultOk(vUnit()) : resultErr(w.error);
    }
    case "NotFound":
    case "Permission":
    case "Exists":
    case "IsADirectory":
    case "NotADirectory":
    case "InvalidPath":
    case "TooLarge":
    case "Unsupported":
      return vVariant(name);
    case "Other":
      return vVariant("Other", [args[0]!]);
    default:
      throw new PanicError(`unknown builtin ${name}`, span);
  }
}
