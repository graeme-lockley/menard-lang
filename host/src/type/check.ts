import type { Ast } from "../reader/ast.ts";
import { nameEquals } from "../reader/ast.ts";
import type { Diagnostic } from "../diagnostic/diagnostic.ts";
import { diagnostic } from "../diagnostic/diagnostic.ts";
import {
  type Type,
  type TypeDef,
  type Scheme,
  type RecordField,
  type VariantCtor,
  prim,
  tFn,
  tList,
  tMap,
  tMaybe,
  tResult,
  tRef,
  typeShow,
  typeEqual,
} from "./types.ts";
import type { Span } from "../reader/span.ts";

export type TypeEnv = {
  /** value bindings: name → scheme */
  values: Map<string, Scheme>;
  /** type defs by name */
  types: Map<string, TypeDef>;
  /** variant ctor → type name */
  ctors: Map<string, { typeName: string; payloads: Type[]; params: string[] }>;
  aliases: Map<string, Type>;
  nextVar: number;
  diagnostics: Diagnostic[];
  /** display aliases for messages */
  displayAlias: Map<string, string>;
  /** types of current loop bindings in order; null when not inside a loop */
  loopBindings: Type[] | null;
};

export function emptyEnv(): TypeEnv {
  const env: TypeEnv = {
    values: new Map(),
    types: new Map(),
    ctors: new Map(),
    aliases: new Map(),
    nextVar: 0,
    diagnostics: [],
    displayAlias: new Map(),
    loopBindings: null,
  };
  installBuiltins(env);
  return env;
}

function installBuiltins(env: TypeEnv): void {
  const I = prim("Int");
  const F = prim("Float");
  const B = prim("Bool");
  const S = prim("Str");
  const U = prim("Unit");
  const C = prim("Char");
  const SB = prim("StringBuffer");

  const binInt = tFn([I, I], I);
  const binIntB = tFn([I, I], B);
  const binFloat = tFn([F, F], F);

  for (const [n, t] of [
    ["+", binInt],
    ["-", binInt],
    ["*", binInt],
    ["/", binInt],
    ["%", binInt],
    ["<", binIntB],
    [">", binIntB],
    ["<=", binIntB],
    [">=", binIntB],
    ["f+", binFloat],
    ["f-", binFloat],
    ["f*", binFloat],
    ["f/", binFloat],
  ] as const) {
    env.values.set(n, { params: [], type: t });
  }

  // intrinsics — polymorphic schemes
  env.values.set("show", {
    params: ["a"],
    type: tFn([{ tag: "param", name: "a" }], S),
  });
  // print / println: variadic; typed specially in inferApp
  env.values.set("print", { params: [], type: tFn([], U) });
  env.values.set("println", { params: [], type: tFn([], U) });
  env.values.set("=", {
    params: ["a"],
    type: tFn([{ tag: "param", name: "a" }, { tag: "param", name: "a" }], B),
  });
  env.values.set("compare", {
    params: ["a"],
    type: tFn([{ tag: "param", name: "a" }, { tag: "param", name: "a" }], I),
  });
  env.values.set("dump", {
    params: ["a"],
    type: tFn([{ tag: "param", name: "a" }], U),
  });

  env.values.set("ref", {
    params: ["a"],
    type: tFn([{ tag: "param", name: "a" }], tRef({ tag: "param", name: "a" })),
  });
  env.values.set("deref", {
    params: ["a"],
    type: tFn([tRef({ tag: "param", name: "a" })], { tag: "param", name: "a" }),
  });

  // Str / Char
  env.values.set("str-byte-length", { params: [], type: tFn([S], I) });
  env.values.set("str-byte", { params: [], type: tFn([S, I], I) });
  env.values.set("str-slice", { params: [], type: tFn([S, I, I], S) });
  env.values.set("str-concat", { params: [], type: tFn([S, S], S) });
  env.values.set("char->str", { params: [], type: tFn([C], S) });

  // Map
  const K = { tag: "param" as const, name: "k" };
  const V = { tag: "param" as const, name: "v" };
  env.values.set("map-new", { params: ["k", "v"], type: tFn([], tMap(K, V)) });
  env.values.set("map-get", {
    params: ["k", "v"],
    type: tFn([tMap(K, V), K], tMaybe(V)),
  });
  env.values.set("map-set", {
    params: ["k", "v"],
    type: tFn([tMap(K, V), K, V], tMap(K, V)),
  });
  env.values.set("map-has", {
    params: ["k", "v"],
    type: tFn([tMap(K, V), K], B),
  });
  env.values.set("map-size", {
    params: ["k", "v"],
    type: tFn([tMap(K, V)], I),
  });
  env.values.set("map-keys", {
    params: ["k", "v"],
    type: tFn([tMap(K, V)], tList(K)),
  });

  // StringBuffer
  env.values.set("sb-new", { params: [], type: tFn([], SB) });
  env.values.set("sb-append!", { params: [], type: tFn([SB, S], U) });
  env.values.set("sb-append-byte!", { params: [], type: tFn([SB, I], U) });
  env.values.set("sb-length", { params: [], type: tFn([SB], I) });
  env.values.set("sb-clear!", { params: [], type: tFn([SB], U) });
  env.values.set("sb-to-str", { params: [], type: tFn([SB], S) });
  env.values.set("sb-take-str!", { params: [], type: tFn([SB], S) });

  // Maybe / Result / List — same registration as user variants: ctors + values
  const a: Type = { tag: "param", name: "a" };
  const tParam: Type = { tag: "param", name: "t" };
  const eParam: Type = { tag: "param", name: "e" };

  env.types.set("Maybe", {
    kind: "variant",
    name: "Maybe",
    params: ["a"],
    ctors: [
      { name: "None", payloads: [], span: { start: 0, end: 0 } },
      { name: "Some", payloads: [a], span: { start: 0, end: 0 } },
    ],
    span: { start: 0, end: 0 },
  });
  env.ctors.set("None", { typeName: "Maybe", payloads: [], params: ["a"] });
  env.ctors.set("Some", { typeName: "Maybe", payloads: [a], params: ["a"] });
  env.values.set("None", { params: ["a"], type: tFn([], tMaybe(a)) });
  env.values.set("Some", { params: ["a"], type: tFn([a], tMaybe(a)) });

  env.types.set("Result", {
    kind: "variant",
    name: "Result",
    params: ["t", "e"],
    ctors: [
      { name: "Ok", payloads: [tParam], span: { start: 0, end: 0 } },
      { name: "Err", payloads: [eParam], span: { start: 0, end: 0 } },
    ],
    span: { start: 0, end: 0 },
  });
  env.ctors.set("Ok", { typeName: "Result", payloads: [tParam], params: ["t", "e"] });
  env.ctors.set("Err", { typeName: "Result", payloads: [eParam], params: ["t", "e"] });
  env.values.set("Ok", { params: ["t", "e"], type: tFn([tParam], tResult(tParam, eParam)) });
  env.values.set("Err", { params: ["t", "e"], type: tFn([eParam], tResult(tParam, eParam)) });

  env.types.set("List", {
    kind: "variant",
    name: "List",
    params: ["a"],
    ctors: [
      { name: "Nil", payloads: [], span: { start: 0, end: 0 } },
      {
        name: "Cons",
        payloads: [a, tList(a)],
        span: { start: 0, end: 0 },
      },
    ],
    span: { start: 0, end: 0 },
  });
  env.ctors.set("Nil", { typeName: "List", payloads: [], params: ["a"] });
  env.ctors.set("Cons", {
    typeName: "List",
    payloads: [a, tList(a)],
    params: ["a"],
  });
  env.values.set("Nil", { params: ["a"], type: tFn([], tList(a)) });
  env.values.set("Cons", { params: ["a"], type: tFn([a, tList(a)], tList(a)) });

  // IoError (§2.15) — closed variant for the host seam
  const ioSpan = { start: 0, end: 0 };
  const ioCtors: { name: string; payloads: Type[] }[] = [
    { name: "NotFound", payloads: [] },
    { name: "Permission", payloads: [] },
    { name: "Exists", payloads: [] },
    { name: "IsADirectory", payloads: [] },
    { name: "NotADirectory", payloads: [] },
    { name: "InvalidPath", payloads: [] },
    { name: "TooLarge", payloads: [] },
    { name: "Other", payloads: [I] },
  ];
  env.types.set("IoError", {
    kind: "variant",
    name: "IoError",
    params: [],
    ctors: ioCtors.map((c) => ({ ...c, span: ioSpan })),
    span: ioSpan,
  });
  const ioType: Type = { tag: "nominal", name: "IoError", args: [], kind: "variant" };
  for (const c of ioCtors) {
    env.ctors.set(c.name, { typeName: "IoError", payloads: c.payloads, params: [] });
    env.values.set(c.name, {
      params: [],
      type: tFn(c.payloads, ioType),
    });
  }

  // Tier-0 host seam (§2.15)
  env.values.set("exit", { params: [], type: tFn([I], U) });
  env.values.set("arg-count", { params: [], type: tFn([], I) });
  env.values.set("arg", { params: [], type: tFn([I], S) });
  env.values.set("write", { params: [], type: tFn([I, S], tResult(U, ioType)) });
  env.values.set("read-file", { params: [], type: tFn([S], tResult(S, ioType)) });
  env.values.set("write-file", { params: [], type: tFn([S, S], tResult(U, ioType)) });

  void F;
}

function err(env: TypeEnv, code: string, message: string, span: Span, notes?: Diagnostic["notes"]): void {
  env.diagnostics.push(
    diagnostic({
      severity: "error",
      category: "type",
      code,
      message,
      span,
      notes,
    }),
  );
}

function freshVar(env: TypeEnv, name?: string): Type {
  return { tag: "var", id: env.nextVar++, name };
}

function symStr(ast: Ast): string | null {
  if (ast.tag !== "sym") return null;
  return new TextDecoder().decode(ast.name);
}

function fieldName(ast: Ast): string | null {
  const s = symStr(ast);
  if (s === null) return null;
  return s.endsWith(":") ? s.slice(0, -1) : s;
}

/** Parse a type expression Ast into a Type (with env aliases / nominals). */
export function parseTypeExpr(env: TypeEnv, ast: Ast, params: Set<string>): Type {
  if (ast.tag === "sym") {
    const n = symStr(ast)!;
    if (params.has(n)) return { tag: "param", name: n };
    if (
      n === "Int" ||
      n === "Float" ||
      n === "Bool" ||
      n === "Char" ||
      n === "Str" ||
      n === "Sym" ||
      n === "Unit" ||
      n === "StringBuffer"
    ) {
      return prim(n);
    }
    if (env.aliases.has(n)) return env.aliases.get(n)!;
    if (env.types.has(n)) {
      return { tag: "nominal", name: n, args: [], kind: env.types.get(n)!.kind === "alias" ? "alias" : env.types.get(n)!.kind };
    }
    err(env, "E_TYPE_UNKNOWN", `unknown type ${n}`, ast.span);
    return freshVar(env);
  }
  if (ast.tag === "list" && ast.kind === "paren" && ast.elems.length === 0) {
    return prim("Unit");
  }
  if (ast.tag === "list" && ast.kind === "paren" && ast.elems.length > 0) {
    const head = ast.elems[0]!;
    const hn = symStr(head);
    if (hn === "List" && ast.elems.length === 2) {
      return tList(parseTypeExpr(env, ast.elems[1]!, params));
    }
    if (hn === "Map" && ast.elems.length === 3) {
      return tMap(
        parseTypeExpr(env, ast.elems[1]!, params),
        parseTypeExpr(env, ast.elems[2]!, params),
      );
    }
    if (hn === "Maybe" && ast.elems.length === 2) {
      return tMaybe(parseTypeExpr(env, ast.elems[1]!, params));
    }
    if (hn === "Result" && ast.elems.length === 3) {
      return tResult(
        parseTypeExpr(env, ast.elems[1]!, params),
        parseTypeExpr(env, ast.elems[2]!, params),
      );
    }
    if (hn === "Ref" && ast.elems.length === 2) {
      return tRef(parseTypeExpr(env, ast.elems[1]!, params));
    }
    if (hn === "Fn") {
      // (Fn T1 T2 -> R) or (Fn -> R)
      const arrowIdx = ast.elems.findIndex(
        (e) => e.tag === "sym" && nameEquals(e.name, "->"),
      );
      if (arrowIdx < 0) {
        err(env, "E_TYPE_FN", "Fn type requires ->", ast.span);
        return freshVar(env);
      }
      const ps = ast.elems.slice(1, arrowIdx).map((e) => parseTypeExpr(env, e, params));
      const ret = parseTypeExpr(env, ast.elems[arrowIdx + 1]!, params);
      return tFn(ps, ret);
    }
    if (hn && env.types.has(hn)) {
      const def = env.types.get(hn)!;
      const args = ast.elems.slice(1).map((e) => parseTypeExpr(env, e, params));
      return {
        tag: "nominal",
        name: hn,
        args,
        kind: def.kind === "alias" ? "alias" : def.kind,
      };
    }
  }
  err(env, "E_TYPE_EXPR", "invalid type expression", ast.span);
  return freshVar(env);
}

type Subst = Map<number, Type>;

function applySubst(t: Type, s: Subst): Type {
  switch (t.tag) {
    case "var":
      return s.has(t.id) ? applySubst(s.get(t.id)!, s) : t;
    case "list":
      return tList(applySubst(t.elem, s));
    case "map":
      return tMap(applySubst(t.key, s), applySubst(t.val, s));
    case "maybe":
      return tMaybe(applySubst(t.elem, s));
    case "result":
      return tResult(applySubst(t.ok, s), applySubst(t.err, s));
    case "ref":
      return tRef(applySubst(t.elem, s));
    case "arr":
      return { tag: "arr", elem: applySubst(t.elem, s), n: t.n };
    case "fn":
      return tFn(t.params.map((p) => applySubst(p, s)), applySubst(t.ret, s));
    case "nominal":
      return { ...t, args: t.args.map((a) => applySubst(a, s)) };
    case "ctor":
      return { ...t, payloads: t.payloads.map((p) => applySubst(p, s)) };
    default:
      return t;
  }
}

function occurs(id: number, t: Type, s: Subst): boolean {
  const t2 = applySubst(t, s);
  switch (t2.tag) {
    case "var":
      return t2.id === id;
    case "list":
    case "maybe":
    case "ref":
      return occurs(id, t2.elem, s);
    case "map":
      return occurs(id, t2.key, s) || occurs(id, t2.val, s);
    case "result":
      return occurs(id, t2.ok, s) || occurs(id, t2.err, s);
    case "arr":
      return occurs(id, t2.elem, s);
    case "fn":
      return t2.params.some((p) => occurs(id, p, s)) || occurs(id, t2.ret, s);
    case "nominal":
      return t2.args.some((a) => occurs(id, a, s));
    case "ctor":
      return t2.payloads.some((p) => occurs(id, p, s));
    default:
      return false;
  }
}

function unify(env: TypeEnv, a: Type, b: Type, s: Subst, span: Span): boolean {
  const ta = applySubst(a, s);
  const tb = applySubst(b, s);
  if (typeEqual(ta, tb)) return true;
  if (ta.tag === "var") {
    if (occurs(ta.id, tb, s)) {
      err(env, "E_TYPE_OCCURS", "infinite type", span);
      return false;
    }
    s.set(ta.id, tb);
    return true;
  }
  if (tb.tag === "var") return unify(env, tb, ta, s, span);
  if (ta.tag === "param" && tb.tag === "param" && ta.name === tb.name) return true;

  if (ta.tag === "list" && tb.tag === "list") return unify(env, ta.elem, tb.elem, s, span);
  if (ta.tag === "maybe" && tb.tag === "maybe") return unify(env, ta.elem, tb.elem, s, span);
  if (ta.tag === "ref" && tb.tag === "ref") return unify(env, ta.elem, tb.elem, s, span);
  if (ta.tag === "map" && tb.tag === "map") {
    return unify(env, ta.key, tb.key, s, span) && unify(env, ta.val, tb.val, s, span);
  }
  if (ta.tag === "result" && tb.tag === "result") {
    return unify(env, ta.ok, tb.ok, s, span) && unify(env, ta.err, tb.err, s, span);
  }
  if (ta.tag === "fn" && tb.tag === "fn") {
    if (ta.params.length !== tb.params.length) {
      err(
        env,
        "E_TYPE_ARITY",
        `function arity mismatch: expected ${ta.params.length}, found ${tb.params.length}`,
        span,
      );
      return false;
    }
    for (let i = 0; i < ta.params.length; i++) {
      if (!unify(env, ta.params[i]!, tb.params[i]!, s, span)) return false;
    }
    return unify(env, ta.ret, tb.ret, s, span);
  }
  if (ta.tag === "nominal" && tb.tag === "nominal" && ta.name === tb.name) {
    if (ta.args.length !== tb.args.length) {
      err(env, "E_TYPE_MISMATCH", `type argument count mismatch for ${ta.name}`, span);
      return false;
    }
    for (let i = 0; i < ta.args.length; i++) {
      if (!unify(env, ta.args[i]!, tb.args[i]!, s, span)) return false;
    }
    return true;
  }

  err(
    env,
    "E_TYPE_MISMATCH",
    `expected ${typeShow(ta)}, found ${typeShow(tb)}`,
    span,
  );
  return false;
}

function instantiate(env: TypeEnv, scheme: Scheme): Type {
  if (scheme.params.length === 0) return scheme.type;
  const map = new Map<string, Type>();
  for (const p of scheme.params) {
    map.set(p, freshVar(env, p));
  }
  return replaceParams(scheme.type, map);
}

function replaceParams(t: Type, map: Map<string, Type>): Type {
  switch (t.tag) {
    case "param":
      return map.get(t.name) ?? t;
    case "list":
      return tList(replaceParams(t.elem, map));
    case "map":
      return tMap(replaceParams(t.key, map), replaceParams(t.val, map));
    case "maybe":
      return tMaybe(replaceParams(t.elem, map));
    case "result":
      return tResult(replaceParams(t.ok, map), replaceParams(t.err, map));
    case "ref":
      return tRef(replaceParams(t.elem, map));
    case "arr":
      return { tag: "arr", elem: replaceParams(t.elem, map), n: t.n };
    case "fn":
      return tFn(t.params.map((p) => replaceParams(p, map)), replaceParams(t.ret, map));
    case "nominal":
      return { ...t, args: t.args.map((a) => replaceParams(a, map)) };
    case "ctor":
      return { ...t, payloads: t.payloads.map((p) => replaceParams(p, map)) };
    default:
      return t;
  }
}

function isShowable(t: Type): boolean {
  switch (t.tag) {
    case "prim":
      return t.name !== "StringBuffer";
    case "ref":
    case "fn":
      return false;
    case "list":
    case "maybe":
      return isShowable(t.elem);
    case "map":
      return isShowable(t.key) && isShowable(t.val);
    case "result":
      return isShowable(t.ok) && isShowable(t.err);
    case "arr":
      return isShowable(t.elem);
    case "nominal":
      return t.args.every(isShowable);
    case "param":
    case "var":
      return true; // checked at instantiation
    default:
      return true;
  }
}

function isOrderable(t: Type): boolean {
  switch (t.tag) {
    case "prim":
      return (
        t.name === "Int" ||
        t.name === "Float" ||
        t.name === "Bool" ||
        t.name === "Char" ||
        t.name === "Str" ||
        t.name === "Sym" ||
        t.name === "Unit"
      );
    case "ref":
    case "fn":
      return false;
    case "list":
    case "maybe":
      return isOrderable(t.elem);
    case "map":
      return isOrderable(t.key) && isOrderable(t.val);
    case "result":
      return isOrderable(t.ok) && isOrderable(t.err);
    case "arr":
      return isOrderable(t.elem);
    case "nominal":
      return t.args.every(isOrderable);
    case "param":
    case "var":
      return true;
    default:
      return true;
  }
}

function expectType(
  env: TypeEnv,
  got: Type,
  expected: Type,
  s: Subst,
  span: Span,
): Type {
  unify(env, got, expected, s, span);
  return applySubst(expected, s);
}

export type TypedProgram = {
  forms: Ast[];
  env: TypeEnv;
};

export function typecheckForms(forms: Ast[]): {
  ok: boolean;
  diagnostics: Diagnostic[];
  env: TypeEnv;
} {
  const env = emptyEnv();
  // Pass 1: collect type definitions and defn signatures (bodies unchecked)
  for (const f of forms) {
    collectDef(env, f);
    collectDefnScheme(env, f);
  }
  // Pass 2: typecheck defn bodies and expressions (sequential let at top level)
  const topLocal = new Map<string, Type>();
  const topSubst: Subst = new Map();
  for (const f of forms) {
    typecheckTop(env, f, topLocal, topSubst);
  }
  return {
    ok: env.diagnostics.length === 0,
    diagnostics: env.diagnostics,
    env,
  };
}

function collectDef(env: TypeEnv, ast: Ast): void {
  if (ast.tag !== "list" || ast.kind !== "paren" || ast.elems.length === 0) return;
  const head = ast.elems[0]!;
  const hn = symStr(head);
  if (hn === "alias" && ast.elems.length >= 3) {
    const name = symStr(ast.elems[1]!);
    if (!name) return;
    const t = parseTypeExpr(env, ast.elems[2]!, new Set());
    env.aliases.set(name, t);
    env.types.set(name, { kind: "alias", name, type: t, span: ast.span });
    env.displayAlias.set(name, name);
    return;
  }
  if (hn === "defrec" && ast.elems.length >= 2) {
    const { name, params } = parseTypeName(ast.elems[1]!);
    if (!name) return;
    const paramSet = new Set(params);
    const fields: RecordField[] = [];
    for (let i = 2; i < ast.elems.length; i++) {
      const fe = ast.elems[i]!;
      if (fe.tag !== "list" || fe.elems.length < 2) continue;
      const fname = fieldName(fe.elems[0]!);
      if (!fname) continue;
      fields.push({
        name: fname,
        type: parseTypeExpr(env, fe.elems[1]!, paramSet),
        span: fe.span,
      });
    }
    env.types.set(name, { kind: "record", name, params, fields, span: ast.span });
    // constructor = record name
    env.ctors.set(name, {
      typeName: name,
      payloads: fields.map((f) => f.type),
      params,
    });
    env.values.set(name, {
      params,
      type: tFn(
        fields.map((f) => f.type),
        { tag: "nominal", name, args: params.map((p) => ({ tag: "param" as const, name: p })), kind: "record" },
      ),
    });
    return;
  }
  if (hn === "variant" && ast.elems.length >= 2) {
    const { name, params } = parseTypeName(ast.elems[1]!);
    if (!name) return;
    const paramSet = new Set(params);
    const ctors: VariantCtor[] = [];
    for (let i = 2; i < ast.elems.length; i++) {
      const ce = ast.elems[i]!;
      if (ce.tag !== "list" || ce.elems.length < 1) continue;
      const cname = symStr(ce.elems[0]!);
      if (!cname) continue;
      const payloads = ce.elems.slice(1).map((e) => parseTypeExpr(env, e, paramSet));
      ctors.push({ name: cname, payloads, span: ce.span });
      env.ctors.set(cname, { typeName: name, payloads, params });
      env.values.set(cname, {
        params,
        type: tFn(
          payloads,
          {
            tag: "nominal",
            name,
            args: params.map((p) => ({ tag: "param" as const, name: p })),
            kind: "variant",
          },
        ),
      });
    }
    env.types.set(name, { kind: "variant", name, params, ctors, span: ast.span });
  }
}

function parseTypeName(ast: Ast): { name: string | null; params: string[] } {
  if (ast.tag === "sym") return { name: symStr(ast), params: [] };
  if (ast.tag === "list" && ast.kind === "paren" && ast.elems.length >= 1) {
    const name = symStr(ast.elems[0]!);
    const params: string[] = [];
    if (ast.elems[1]?.tag === "list" && ast.elems[1].kind === "bracket") {
      for (const p of ast.elems[1].elems) {
        const n = symStr(p);
        if (n) params.push(n);
      }
    }
    return { name, params };
  }
  return { name: null, params: [] };
}

function typecheckTop(
  env: TypeEnv,
  ast: Ast,
  topLocal: Map<string, Type>,
  topSubst: Subst,
): void {
  if (ast.tag !== "list" || ast.kind !== "paren" || ast.elems.length === 0) {
    infer(env, ast, topLocal, topSubst);
    return;
  }
  const hn = symStr(ast.elems[0]!);
  if (hn === "alias" || hn === "defrec" || hn === "variant") return;
  if (hn === "defn") {
    typecheckDefn(env, ast);
    return;
  }
  // Top-level (let x e) binds for later forms; (let x e body…) is a full expression
  if (hn === "let" && ast.elems.length === 3) {
    const n = symStr(ast.elems[1]!);
    const t = infer(env, ast.elems[2]!, topLocal, topSubst);
    if (n) topLocal.set(n, t);
    return;
  }
  infer(env, ast, topLocal, topSubst);
}

function typecheckDefn(env: TypeEnv, ast: Ast & { tag: "list" }): void {
  // Scheme was registered in pass 1; check the body only.
  const parsed = parseDefn(env, ast, true);
  if (!parsed) return;

  const local = new Map<string, Type>();
  for (let i = 0; i < parsed.paramNames.length; i++) {
    local.set(parsed.paramNames[i]!, parsed.paramTypes[i]!);
  }
  const subst: Subst = new Map();
  const bodyType =
    parsed.body.length === 0
      ? prim("Unit")
      : inferSequence(env, parsed.body, local, subst);
  expectType(
    env,
    bodyType,
    parsed.retType,
    subst,
    parsed.body[parsed.body.length - 1]?.span ?? ast.span,
  );
}

/** Register a defn's scheme without checking its body (pass 1). */
function collectDefnScheme(env: TypeEnv, ast: Ast): void {
  if (ast.tag !== "list" || ast.kind !== "paren" || ast.elems.length === 0) return;
  if (symStr(ast.elems[0]!) !== "defn") return;
  const parsed = parseDefn(env, ast, false);
  if (!parsed) return;
  env.values.set(parsed.name, {
    params: parsed.typeParams,
    type: tFn(parsed.paramTypes, parsed.retType),
  });
}

type ParsedDefn = {
  name: string;
  typeParams: string[];
  paramNames: string[];
  paramTypes: Type[];
  retType: Type;
  body: Ast[];
};

/** Parse a defn header. When `report` is true, emit diagnostics on malformation. */
function parseDefn(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  report: boolean,
): ParsedDefn | null {
  if (ast.elems.length < 3) {
    if (report) err(env, "E_TYPE_DEFN", "malformed defn", ast.span);
    return null;
  }
  let name: string | null;
  let typeParams: string[] = [];
  let idx = 1;
  const namePart = ast.elems[1]!;
  if (namePart.tag === "sym") {
    name = symStr(namePart);
    idx = 2;
  } else if (namePart.tag === "list" && namePart.kind === "paren") {
    name = symStr(namePart.elems[0]!);
    if (namePart.elems[1]?.tag === "list" && namePart.elems[1].kind === "bracket") {
      for (const p of namePart.elems[1].elems) {
        const n = symStr(p);
        if (n) typeParams.push(n);
      }
    }
    idx = 2;
  } else {
    if (report) err(env, "E_TYPE_DEFN", "malformed defn name", namePart.span);
    return null;
  }
  if (!name) return null;

  const paramSet = new Set(typeParams);
  const paramTypes: Type[] = [];
  const paramNames: string[] = [];
  while (idx < ast.elems.length) {
    const e = ast.elems[idx]!;
    if (e.tag === "sym" && nameEquals(e.name, "->")) {
      idx++;
      break;
    }
    if (e.tag === "list" && e.elems.length >= 2) {
      const pn = fieldName(e.elems[0]!) ?? symStr(e.elems[0]!);
      if (pn) {
        paramNames.push(pn);
        paramTypes.push(parseTypeExpr(env, e.elems[1]!, paramSet));
      }
      idx++;
      continue;
    }
    break;
  }
  if (idx >= ast.elems.length) {
    if (report) err(env, "E_TYPE_DEFN", "defn missing return type", ast.span);
    return null;
  }
  const retType = parseTypeExpr(env, ast.elems[idx]!, paramSet);
  idx++;
  return {
    name,
    typeParams,
    paramNames,
    paramTypes,
    retType,
    body: ast.elems.slice(idx),
  };
}

function infer(
  env: TypeEnv,
  ast: Ast,
  local: Map<string, Type>,
  subst: Subst,
): Type {
  switch (ast.tag) {
    case "int":
      return prim("Int");
    case "float":
      return prim("Float");
    case "bool":
      return prim("Bool");
    case "str":
      return prim("Str");
    case "sym": {
      const n = symStr(ast)!;
      if (n === "_") return freshVar(env);
      if (local.has(n)) return applySubst(local.get(n)!, subst);
      if (env.values.has(n)) return instantiate(env, env.values.get(n)!);
      // nullary ctor?
      if (env.ctors.has(n)) {
        return instantiate(env, env.values.get(n)!);
      }
      err(env, "E_TYPE_UNBOUND", `unbound variable ${n}`, ast.span);
      return freshVar(env);
    }
    case "list": {
      if (ast.kind === "bracket") {
        // [e1 e2…] → List
        if (ast.elems.length === 0) {
          return tList(freshVar(env));
        }
        const et = infer(env, ast.elems[0]!, local, subst);
        for (let i = 1; i < ast.elems.length; i++) {
          expectType(env, infer(env, ast.elems[i]!, local, subst), et, subst, ast.elems[i]!.span);
        }
        return tList(et);
      }
      if (ast.elems.length === 0) return prim("Unit");
      const head = ast.elems[0]!;
      const hn = symStr(head);
      if (hn === "if") return inferIf(env, ast, local, subst);
      if (hn === "let") return inferLet(env, ast, local, subst);
      if (hn === "do") return inferDo(env, ast, local, subst);
      if (hn === "loop") return inferLoop(env, ast, local, subst);
      if (hn === "recur") return inferRecur(env, ast, local, subst);
      if (hn === "panic") {
        if (ast.elems[1]) infer(env, ast.elems[1]!, local, subst);
        return freshVar(env); // never
      }
      if (hn === "return") {
        if (ast.elems[1]) return infer(env, ast.elems[1]!, local, subst);
        return prim("Unit");
      }
      if (hn === "match") return inferMatch(env, ast, local, subst);
      if (hn === "fn" || hn === "lambda") return inferLambda(env, ast, local, subst);
      if (hn === "quote") {
        return inferQuote(ast.elems[1] ?? ast);
      }
      if (hn === "set!") {
        // (set! r v)
        if (ast.elems.length !== 3) {
          err(env, "E_TYPE_ARITY", "set! expects 2 arguments", ast.span);
          return prim("Unit");
        }
        const rt = infer(env, ast.elems[1]!, local, subst);
        const vt = infer(env, ast.elems[2]!, local, subst);
        const elem = freshVar(env);
        expectType(env, rt, tRef(elem), subst, ast.elems[1]!.span);
        expectType(env, vt, elem, subst, ast.elems[2]!.span);
        return prim("Unit");
      }
      // application
      return inferApp(env, ast, local, subst);
    }
  }
}

function inferQuote(ast: Ast): Type {
  switch (ast.tag) {
    case "int":
      return prim("Int");
    case "float":
      return prim("Float");
    case "bool":
      return prim("Bool");
    case "str":
      return prim("Str");
    case "sym":
      return prim("Sym");
    case "list":
      return tList(prim("Sym")); // simplified
  }
}

function inferIf(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  if (ast.elems.length !== 4) {
    err(env, "E_TYPE_ARITY", "if expects test, then, else", ast.span);
    return freshVar(env);
  }
  expectType(env, infer(env, ast.elems[1]!, local, subst), prim("Bool"), subst, ast.elems[1]!.span);
  const th = infer(env, ast.elems[2]!, local, subst);
  const el = infer(env, ast.elems[3]!, local, subst);
  expectType(env, el, th, subst, ast.elems[3]!.span);
  return applySubst(th, subst);
}

function inferLet(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  // (let x e) or (let x e body…) — sequential; last is result if body present
  // Simplified: (let name expr) binds; if more forms follow as siblings in do — handle (let x e) only as binding form returning Unit, or Scheme-like (let x e body)
  if (ast.elems.length < 3) {
    err(env, "E_TYPE_LET", "let requires name and expression", ast.span);
    return freshVar(env);
  }
  const name = symStr(ast.elems[1]!);
  if (!name) {
    err(env, "E_TYPE_LET", "let name must be a symbol", ast.elems[1]!.span);
    return freshVar(env);
  }
  const t = infer(env, ast.elems[2]!, local, subst);
  const next = new Map(local);
  next.set(name, t);
  if (ast.elems.length === 3) return t;
  let last: Type = t;
  for (let i = 3; i < ast.elems.length; i++) {
    last = infer(env, ast.elems[i]!, next, subst);
  }
  return last;
}

function inferDo(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  return inferSequence(env, ast.elems.slice(1), local, subst);
}

/** Sequence of forms with do-like sequential `let` binding (spec §2.4). */
function inferSequence(
  env: TypeEnv,
  forms: Ast[],
  local: Map<string, Type>,
  subst: Subst,
): Type {
  let last: Type = prim("Unit");
  const loc = new Map(local);
  for (const e of forms) {
    if (
      e.tag === "list" &&
      e.elems[0] &&
      symStr(e.elems[0]) === "let" &&
      e.elems.length === 3
    ) {
      const n = symStr(e.elems[1]!);
      const t = infer(env, e.elems[2]!, loc, subst);
      if (n) loc.set(n, t);
      last = t;
      continue;
    }
    last = infer(env, e, loc, subst);
  }
  return last;
}

function inferLoop(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  // (loop ((x e)…) body)
  if (ast.elems.length < 3) {
    err(env, "E_TYPE_LOOP", "loop requires bindings and body", ast.span);
    return freshVar(env);
  }
  const bindings = ast.elems[1]!;
  const loc = new Map(local);
  const bindingTypes: Type[] = [];
  if (bindings.tag === "list") {
    for (const b of bindings.elems) {
      if (b.tag === "list" && b.elems.length >= 2) {
        const n = symStr(b.elems[0]!);
        const t = infer(env, b.elems[1]!, local, subst);
        bindingTypes.push(t);
        if (n) loc.set(n, t);
      }
    }
  }
  const prev = env.loopBindings;
  env.loopBindings = bindingTypes;
  const body = infer(env, ast.elems[2]!, loc, subst);
  env.loopBindings = prev;
  return body;
}

/** recur is a tail jump: check args against loop bindings; type is fresh (never). */
function inferRecur(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  if (env.loopBindings === null) {
    err(env, "E_TYPE_RECUR", "recur outside loop", ast.span);
    return freshVar(env);
  }
  const args = ast.elems.slice(1);
  const expected = env.loopBindings;
  if (args.length !== expected.length) {
    err(
      env,
      "E_TYPE_ARITY",
      `recur expects ${expected.length} argument${expected.length === 1 ? "" : "s"}, got ${args.length}`,
      ast.span,
    );
  }
  const n = Math.min(args.length, expected.length);
  for (let i = 0; i < n; i++) {
    expectType(env, infer(env, args[i]!, local, subst), expected[i]!, subst, args[i]!.span);
  }
  return freshVar(env);
}

function inferLambda(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  // (fn (a b) body) — unannotated params as fresh vars
  if (ast.elems.length < 3) {
    err(env, "E_TYPE_FN", "fn requires params and body", ast.span);
    return freshVar(env);
  }
  const paramsAst = ast.elems[1]!;
  const loc = new Map(local);
  const pts: Type[] = [];
  if (paramsAst.tag === "list") {
    for (const p of paramsAst.elems) {
      const n = symStr(p);
      const v = freshVar(env);
      pts.push(v);
      if (n) loc.set(n, v);
    }
  }
  const body = infer(env, ast.elems[2]!, loc, subst);
  return tFn(pts.map((p) => applySubst(p, subst)), applySubst(body, subst));
}

function inferMatch(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  // (match e pat1 body1 pat2 body2 …)
  if (ast.elems.length < 3) {
    err(env, "E_TYPE_MATCH", "match requires scrutinee and clauses", ast.span);
    return freshVar(env);
  }
  const scrut = infer(env, ast.elems[1]!, local, subst);
  let result: Type | null = null;
  const covered = new Set<string>();
  let hasWild = false;

  const rest = ast.elems.slice(2);
  if (rest.length % 2 !== 0) {
    err(env, "E_TYPE_MATCH", "match clauses must be pattern/body pairs", ast.span);
  }
  for (let i = 0; i + 1 < rest.length; i += 2) {
    const pat = rest[i]!;
    const body = rest[i + 1]!;
    const loc = new Map(local);
    bindPattern(env, pat, scrut, loc, subst, covered);
    if (pat.tag === "sym" && symStr(pat) === "_") hasWild = true;
    const bt = infer(env, body, loc, subst);
    if (result === null) result = bt;
    else expectType(env, bt, result, subst, body.span);
  }

  if (
    scrut.tag === "nominal" ||
    scrut.tag === "maybe" ||
    scrut.tag === "result" ||
    scrut.tag === "list"
  ) {
    let typeName: string | null = null;
    if (scrut.tag === "nominal") typeName = scrut.name;
    if (scrut.tag === "maybe") typeName = "Maybe";
    if (scrut.tag === "result") typeName = "Result";
    if (scrut.tag === "list") typeName = "List";
    if (typeName && env.types.has(typeName)) {
      const def = env.types.get(typeName)!;
      if (def.kind === "variant" && !hasWild) {
        for (const c of def.ctors) {
          if (!covered.has(c.name)) {
            err(
              env,
              "E_TYPE_EXHAUSTIVE",
              `non-exhaustive match: missing ${c.name}`,
              ast.span,
            );
          }
        }
      }
    }
  }

  return result ?? freshVar(env);
}

function bindPattern(
  env: TypeEnv,
  pat: Ast,
  scrut: Type,
  local: Map<string, Type>,
  subst: Subst,
  covered: Set<string>,
): void {
  if (pat.tag === "sym") {
    const n = symStr(pat)!;
    if (n === "_") return;
    if (env.ctors.has(n)) {
      covered.add(n);
      const ctor = env.ctors.get(n)!;
      const nominal: Type = {
        tag: "nominal",
        name: ctor.typeName,
        args: ctor.params.map(() => freshVar(env)),
        kind: "variant",
      };
      // also handle Maybe/List/Result as special tags
      if (ctor.typeName === "Maybe") {
        expectType(env, scrut, tMaybe(freshVar(env)), subst, pat.span);
      } else if (ctor.typeName === "List") {
        expectType(env, scrut, tList(freshVar(env)), subst, pat.span);
      } else if (ctor.typeName === "Result") {
        expectType(env, scrut, tResult(freshVar(env), freshVar(env)), subst, pat.span);
      } else {
        expectType(env, scrut, nominal, subst, pat.span);
      }
      return;
    }
    local.set(n, applySubst(scrut, subst));
    return;
  }
  if (pat.tag === "int") {
    expectType(env, scrut, prim("Int"), subst, pat.span);
    return;
  }
  if (pat.tag === "str") {
    expectType(env, scrut, prim("Str"), subst, pat.span);
    return;
  }
  if (pat.tag === "list" && pat.elems.length >= 1) {
    const cn = symStr(pat.elems[0]!);
    if (cn && env.ctors.has(cn)) {
      covered.add(cn);
      const ctor = env.ctors.get(cn)!;
      const argVars = ctor.params.map(() => freshVar(env));
      const paramMap = new Map<string, Type>();
      for (let i = 0; i < ctor.params.length; i++) {
        paramMap.set(ctor.params[i]!, argVars[i]!);
      }
      const payloads = ctor.payloads.map((p) => replaceParams(p, paramMap));
      if (ctor.typeName === "Maybe") {
        expectType(env, scrut, tMaybe(argVars[0] ?? freshVar(env)), subst, pat.span);
      } else if (ctor.typeName === "List") {
        expectType(env, scrut, tList(argVars[0] ?? freshVar(env)), subst, pat.span);
      } else if (ctor.typeName === "Result") {
        expectType(
          env,
          scrut,
          tResult(argVars[0] ?? freshVar(env), argVars[1] ?? freshVar(env)),
          subst,
          pat.span,
        );
      } else {
        expectType(
          env,
          scrut,
          { tag: "nominal", name: ctor.typeName, args: argVars, kind: "variant" },
          subst,
          pat.span,
        );
      }
      for (let i = 0; i < payloads.length; i++) {
        const p = pat.elems[i + 1];
        if (p) bindPattern(env, p, payloads[i]!, local, subst, new Set());
      }
    }
  }
}

function inferApp(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  const hn = symStr(ast.elems[0]!);

  // Variadic print / println: Str raw; other args must be showable
  if (hn === "print" || hn === "println") {
    for (let i = 1; i < ast.elems.length; i++) {
      const t = applySubst(infer(env, ast.elems[i]!, local, subst), subst);
      const isStr = t.tag === "prim" && t.name === "Str";
      if (!isStr && !isShowable(t)) {
        err(
          env,
          "E_TYPE_SHOWABLE",
          `type ${typeShow(t)} is not showable`,
          ast.elems[i]!.span,
        );
      }
    }
    return prim("Unit");
  }

  const callee = infer(env, ast.elems[0]!, local, subst);
  const args = ast.elems.slice(1).map((a) => infer(env, a, local, subst));
  const ret = freshVar(env);
  // unify callee with fn of arg types
  if (!unify(env, callee, tFn(args, ret), subst, ast.span)) {
    // try arity message already emitted
  }
  if (hn === "show") {
    const a0 = applySubst(args[0] ?? freshVar(env), subst);
    if (!isShowable(a0)) {
      err(
        env,
        "E_TYPE_SHOWABLE",
        `type ${typeShow(a0)} is not showable`,
        ast.elems[1]?.span ?? ast.span,
      );
    }
  }
  if (hn === "compare") {
    const a0 = applySubst(args[0] ?? freshVar(env), subst);
    if (!isOrderable(a0)) {
      err(
        env,
        "E_TYPE_ORDERABLE",
        `type ${typeShow(a0)} is not orderable`,
        ast.elems[1]?.span ?? ast.span,
      );
    }
  }
  if (hn === "map-new" || hn === "map-set" || hn === "map-get") {
    // Map keys must be orderable — checked when key type known
  }
  return applySubst(ret, subst);
}
