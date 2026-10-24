import type { Ast } from "../reader/ast.ts";
import { nameEquals } from "../reader/ast.ts";
import { declarationNames } from "../interp/modules.ts";
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
  tProduct,
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
  /** qualified import alias → that module's exports */
  modules: Map<string, ImportBundle>;
  /** nominals brought in by import, so a pub signature may name them */
  importedTypes: Set<string>;
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
    modules: new Map(),
    importedTypes: new Set(),
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

  const mapKey: Type = { tag: "param", name: "k" };
  const mapVal: Type = { tag: "param", name: "v" };
  const mapType = tMap(mapKey, mapVal);
  env.values.set("map-new", { params: ["k", "v"], type: tFn([], mapType) });
  env.values.set("map-set", {
    params: ["k", "v"],
    type: tFn([mapType, mapKey, mapVal], mapType),
  });
  env.values.set("map-get", {
    params: ["k", "v"],
    type: tFn([mapType, mapKey], tMaybe(mapVal)),
  });
  env.values.set("map-has", {
    params: ["k", "v"],
    type: tFn([mapType, mapKey], B),
  });
  env.values.set("map-keys", {
    params: ["k", "v"],
    type: tFn([mapType], tList(mapKey)),
  });

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
    if (hn === "product") {
      if (ast.elems.length < 3) {
        err(env, "E_TYPE_EXPR", "product type requires at least two factors", ast.span);
        return freshVar(env);
      }
      return tProduct(ast.elems.slice(1).map((e) => parseTypeExpr(env, e, params)));
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
    case "product":
      return tProduct(t.elems.map((e) => applySubst(e, s)));
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
    case "product":
      return t2.elems.some((e) => occurs(id, e, s));
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
  if (ta.tag === "product" && tb.tag === "product") {
    if (ta.elems.length !== tb.elems.length) {
      err(
        env,
        "E_TYPE_ARITY",
        `product arity mismatch: expected ${ta.elems.length}, found ${tb.elems.length}`,
        span,
      );
      return false;
    }
    for (let i = 0; i < ta.elems.length; i++) {
      if (!unify(env, ta.elems[i]!, tb.elems[i]!, s, span)) return false;
    }
    return true;
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
    case "product":
      return tProduct(t.elems.map((e) => replaceParams(e, map)));
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
    case "product":
      return t.elems.every(isShowable);
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
    case "product":
      return t.elems.every(isOrderable);
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

function collectPubNames(forms: Ast[]): Set<string> {
  const names = new Set<string>();
  for (const f of forms) {
    if (f.tag !== "list" || f.elems.length < 2 || symStr(f.elems[0]!) !== "pub") continue;
    for (const n of declarationNames(unwrapPubList(f))) names.add(n);
  }
  return names;
}

export function typecheckForms(
  forms: Ast[],
  opts: {
    /** Schemes/types from imported modules, applied after builtins. */
    imports?: ImportBundle[];
    /** Qualified imports: values stay behind the alias; types are in scope. */
    qualified?: { alias: string; bundle: ImportBundle }[];
    /** If set, pub signatures may not mention private nominals of this module. */
    exports?: Set<string>;
  } = {},
): {
  ok: boolean;
  diagnostics: Diagnostic[];
  env: TypeEnv;
  bundle: ImportBundle;
} {
  const env = emptyEnv();
  for (const b of opts.imports ?? []) {
    mergeImportBundle(env, b);
  }
  for (const q of opts.qualified ?? []) {
    bindQualified(env, q.alias, q.bundle);
  }
  const skipDup = new Set<Ast>();
  registerTypeStubs(env, forms, skipDup);
  for (const f of forms) {
    if (skipDup.has(f)) continue;
    collectDef(env, f);
    collectDefnScheme(env, f);
    collectExternScheme(env, f);
    collectRuntimeScheme(env, f);
  }
  const topLocal = new Map<string, Type>();
  const topSubst: Subst = new Map();
  for (const f of forms) {
    typecheckTop(env, f, topLocal, topSubst);
  }
  checkPubPrivateTypes(env, forms, opts.exports ?? collectPubNames(forms));
  return {
    ok: env.diagnostics.length === 0,
    diagnostics: env.diagnostics,
    env,
    bundle: bundleExports(env, opts.exports ?? new Set()),
  };
}

export type ImportBundle = {
  values: Map<string, Scheme>;
  types: Map<string, TypeDef>;
  ctors: Map<string, { typeName: string; payloads: Type[]; params: string[] }>;
  aliases: Map<string, Type>;
};

function mergeImportBundle(env: TypeEnv, b: ImportBundle): void {
  for (const [k, v] of b.values) env.values.set(k, v);
  mergeImportTypes(env, b);
}

function bindQualified(env: TypeEnv, alias: string, b: ImportBundle): void {
  env.modules.set(alias, b);
  mergeImportTypes(env, b);
}

function mergeImportTypes(env: TypeEnv, b: ImportBundle): void {
  for (const [k, v] of b.types) {
    env.types.set(k, v);
    env.importedTypes.add(k);
  }
  for (const [k, v] of b.ctors) env.ctors.set(k, v);
  for (const [k, v] of b.aliases) {
    env.aliases.set(k, v);
    env.displayAlias.set(k, k);
  }
}

function bundleExports(env: TypeEnv, exports: Set<string>): ImportBundle {
  const values = new Map<string, Scheme>();
  const types = new Map<string, TypeDef>();
  const ctors = new Map<string, { typeName: string; payloads: Type[]; params: string[] }>();
  const aliases = new Map<string, Type>();
  for (const name of exports) {
    const s = env.values.get(name);
    if (s) values.set(name, s);
    const t = env.types.get(name);
    if (t) types.set(name, t);
    const c = env.ctors.get(name);
    if (c) ctors.set(name, c);
    const a = env.aliases.get(name);
    if (a) aliases.set(name, a);
  }
  return { values, types, ctors, aliases };
}

const BUILTIN_NOMINALS = new Set([
  "Maybe",
  "Result",
  "List",
  "Map",
  "StringBuffer",
  "Ref",
  "Fn",
]);

function checkPubPrivateTypes(env: TypeEnv, forms: Ast[], exports: Set<string>): void {
  for (const raw of forms) {
    const f = unwrapPubList(raw);
    if (f.tag !== "list" || f.elems.length === 0) continue;
    const hn = symStr(f.elems[0]!);
    if (hn !== "defn" && hn !== "extern" && hn !== "runtime") continue;
    const names = declarationNames(f);
    if (!names.some((n) => exports.has(n))) continue;
    const scheme = env.values.get(names[0]!);
    if (!scheme) continue;
    const leaked = nominalNamesInType(scheme.type).filter(
      (n) =>
        env.types.has(n) &&
        !exports.has(n) &&
        !env.importedTypes.has(n) &&
        !BUILTIN_NOMINALS.has(n),
    );
    if (leaked.length > 0) {
      err(
        env,
        "E_PUB_PRIVATE_TYPE",
        `pub signature mentions private type ${leaked[0]}`,
        f.span,
      );
    }
  }
}

function nominalNamesInType(t: Type): string[] {
  switch (t.tag) {
    case "nominal":
      return [t.name, ...t.args.flatMap(nominalNamesInType)];
    case "fn":
      return [...t.params.flatMap(nominalNamesInType), ...nominalNamesInType(t.ret)];
    case "list":
    case "maybe":
    case "ref":
      return nominalNamesInType(t.elem);
    case "map":
      return [...nominalNamesInType(t.key), ...nominalNamesInType(t.val)];
    case "result":
      return [...nominalNamesInType(t.ok), ...nominalNamesInType(t.err)];
    case "arr":
      return nominalNamesInType(t.elem);
    case "product":
      return t.elems.flatMap(nominalNamesInType);
    default:
      return [];
  }
}

function collectRuntimeScheme(env: TypeEnv, ast: Ast): void {
  if (ast.tag !== "list" || ast.elems.length === 0) return;
  if (symStr(ast.elems[0]!) === "pub" && ast.elems.length >= 2) {
    collectRuntimeScheme(env, {
      tag: "list",
      kind: ast.kind,
      elems: ast.elems.slice(1),
      span: ast.span,
    });
    return;
  }
  if (symStr(ast.elems[0]!) !== "runtime") return;
  collectExternScheme(env, {
    tag: "list",
    kind: ast.kind,
    elems: [{ tag: "sym", name: new TextEncoder().encode("extern"), span: ast.span }, ...ast.elems.slice(1)],
    span: ast.span,
  });
}

function collectExternScheme(env: TypeEnv, ast: Ast): void {
  if (ast.tag !== "list" || ast.elems.length === 0) return;
  if (symStr(ast.elems[0]!) !== "extern") return;
  // Reuse defn header parsing by synthesizing a defn-shaped list without body
  const fake: Ast & { tag: "list" } = {
    tag: "list",
    kind: ast.kind,
    elems: [{ tag: "sym", name: new TextEncoder().encode("defn"), span: ast.span }, ...ast.elems.slice(1)],
    span: ast.span,
  };
  const parsed = parseDefn(env, fake, true);
  if (!parsed) return;
  env.values.set(parsed.name, {
    params: parsed.typeParams,
    type: tFn(parsed.paramTypes, parsed.retType),
  });
}

function unwrapPubList(ast: Ast): Ast {
  if (ast.tag === "list" && ast.kind === "paren" && symStr(ast.elems[0]!) === "pub" && ast.elems.length >= 2) {
    return { tag: "list", kind: "paren", elems: ast.elems.slice(1), span: ast.span };
  }
  return ast;
}

function nominalDecl(ast: Ast): { kind: "record" | "variant"; name: string; params: string[] } | null {
  const inner = unwrapPubList(ast);
  if (inner.tag !== "list" || inner.kind !== "paren" || inner.elems.length < 2) return null;
  const hn = symStr(inner.elems[0]!);
  if (hn !== "defrec" && hn !== "variant") return null;
  const parsed = parseTypeName(inner.elems[1]!);
  if (!parsed.name) return null;
  return { kind: hn === "defrec" ? "record" : "variant", name: parsed.name, params: parsed.params };
}

/** Every record and variant name is in scope before any field or payload is checked. */
function registerTypeStubs(env: TypeEnv, forms: Ast[], skipDup: Set<Ast>): void {
  const seen = new Set<string>();
  for (const f of forms) {
    const info = nominalDecl(f);
    if (!info) continue;
    if (seen.has(info.name)) {
      err(env, "E_TYPE_DUPLICATE", `type ${info.name} is already defined`, f.span);
      skipDup.add(f);
      continue;
    }
    seen.add(info.name);
    if (info.kind === "record") {
      env.types.set(info.name, {
        kind: "record",
        name: info.name,
        params: info.params,
        fields: [],
        span: f.span,
      });
    } else {
      env.types.set(info.name, {
        kind: "variant",
        name: info.name,
        params: info.params,
        ctors: [],
        span: f.span,
      });
    }
  }
}

function collectDef(env: TypeEnv, ast: Ast): void {
  if (ast.tag !== "list" || ast.kind !== "paren" || ast.elems.length === 0) return;
  const head = ast.elems[0]!;
  const hn = symStr(head);
  if (hn === "pub" && ast.elems.length >= 2) {
    const inner: Ast = {
      tag: "list",
      kind: ast.kind,
      elems: ast.elems.slice(1),
      span: ast.span,
    };
    collectDef(env, inner);
    return;
  }
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
    // Register the name before payloads so a variant can mention itself.
    env.types.set(name, { kind: "variant", name, params, ctors: [], span: ast.span });
    const ctors: VariantCtor[] = [];
    for (let i = 2; i < ast.elems.length; i++) {
      const ce = ast.elems[i]!;
      if (ce.tag !== "list" || ce.elems.length < 1) continue;
      const cname = symStr(ce.elems[0]!);
      if (!cname) continue;
      const payloads = ce.elems.slice(1).map((e) => parseTypeExpr(env, e, paramSet));
      ctors.push({ name: cname, payloads, span: ce.span });
      const existing = env.ctors.get(cname);
      if (existing && existing.typeName !== name) continue;
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
  if (hn === "pub" && ast.elems.length >= 2) {
    typecheckTop(
      env,
      { tag: "list", kind: ast.kind, elems: ast.elems.slice(1), span: ast.span },
      topLocal,
      topSubst,
    );
    return;
  }
  if (hn === "alias" || hn === "defrec" || hn === "variant" || hn === "extern" || hn === "runtime") return;
  if (hn === "defn") {
    typecheckDefn(env, ast);
    return;
  }
  // Top-level (let x e) binds for later forms; (let x e body…) is a full expression
  if (hn === "let" && ast.elems.length === 3) {
    const binder = ast.elems[1]!;
    const t = infer(env, ast.elems[2]!, topLocal, topSubst);
    const n = symStr(binder);
    if (n) {
      topLocal.set(n, t);
      // A module-level value, visible to later `defn` bodies and to importers.
      env.values.set(n, { params: [], type: t });
    } else {
      bindPattern(env, binder, t, topLocal, topSubst, new Set());
    }
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
  if (symStr(ast.elems[0]!) === "pub" && ast.elems.length >= 2) {
    collectDefnScheme(env, {
      tag: "list",
      kind: ast.kind,
      elems: ast.elems.slice(1),
      span: ast.span,
    });
    return;
  }
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
      const head = fieldName(e.elems[0]!) ?? symStr(e.elems[0]!);
      if (head === "param" && e.elems.length >= 3) {
        // Desugar should have rewritten these; accept as a typed slot named __pN.
        const pname = `__p${paramNames.length}`;
        paramNames.push(pname);
        paramTypes.push(parseTypeExpr(env, e.elems[2]!, paramSet));
        idx++;
        continue;
      }
      if (head) {
        paramNames.push(head.endsWith(":") ? head.slice(0, -1) : head);
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
      if (hn === "defer") {
        if (ast.elems[1]) infer(env, ast.elems[1]!, local, subst);
        return prim("Unit");
      }
      if (hn === "match") return inferMatch(env, ast, local, subst);
      if (hn === "fn" || hn === "lambda") return inferLambda(env, ast, local, subst);
      if (hn === "quote") {
        return inferQuote(ast.elems[1] ?? ast);
      }
      if (hn === "char") return prim("Char");
      if (hn === "project") return inferProject(env, ast, local, subst);
      if (hn === "tuple") return inferTuple(env, ast, local, subst);
      if (hn === "?") return inferQues(env, ast, local, subst);
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

/** `(? lhs rhs)` — unwrap Maybe/Result; `rhs` runs only on None/Err. */
function inferQues(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  if (ast.elems.length !== 3 || !ast.elems[1] || !ast.elems[2]) {
    err(env, "E_TYPE_ARITY", "? expects a Maybe or Result and a default", ast.span);
    return freshVar(env);
  }
  const lhs = applySubst(infer(env, ast.elems[1], local, subst), subst);
  let payload: Type;
  if (lhs.tag === "maybe") {
    payload = lhs.elem;
  } else if (lhs.tag === "result") {
    payload = lhs.ok;
  } else if (lhs.tag === "var") {
    payload = freshVar(env);
    expectType(env, lhs, tMaybe(payload), subst, ast.elems[1].span);
  } else {
    err(
      env,
      "E_TYPE_MISMATCH",
      `expected a Maybe or Result, found ${typeShow(lhs)}`,
      ast.elems[1].span,
    );
    return freshVar(env);
  }
  const rhs = infer(env, ast.elems[2], local, subst);
  expectType(env, rhs, applySubst(payload, subst), subst, ast.elems[2].span);
  return applySubst(payload, subst);
}

function inferTuple(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  if (ast.elems.length < 3) {
    err(env, "E_TYPE_ARITY", "tuple requires at least two elements", ast.span);
    return freshVar(env);
  }
  const elems = ast.elems.slice(1).map((e) => infer(env, e, local, subst));
  return tProduct(elems);
}

function inferProject(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  const obj = ast.elems[1];
  const fieldAst = ast.elems[2];
  if (!obj || !fieldAst) {
    err(env, "E_TYPE_ARITY", "project expects a value and a field", ast.span);
    return freshVar(env);
  }
  if (fieldAst.tag === "int") {
    const idx = Number(fieldAst.value);
    if (idx < 1) {
      err(env, "E_TYPE_UNBOUND", "tuple projection must be a positive index", fieldAst.span);
      return freshVar(env);
    }
    const objTy = applySubst(infer(env, obj, local, subst), subst);
    if (objTy.tag !== "product") {
      err(env, "E_TYPE_MISMATCH", `expected a product, found ${typeShow(objTy)}`, obj.span);
      return freshVar(env);
    }
    if (idx > objTy.elems.length) {
      err(
        env,
        "E_TYPE_UNBOUND",
        `tuple index ${idx} out of range for product of ${objTy.elems.length}`,
        fieldAst.span,
      );
      return freshVar(env);
    }
    return objTy.elems[idx - 1]!;
  }
  if (fieldAst.tag !== "sym") {
    err(env, "E_TYPE_ARITY", "project expects a value and a field", ast.span);
    return freshVar(env);
  }
  const field = symStr(fieldAst)!;
  if (obj.tag === "sym") {
    const bundle = env.modules.get(symStr(obj)!);
    if (bundle) {
      const scheme = bundle.values.get(field);
      if (!scheme) {
        err(env, "E_TYPE_UNBOUND", `unknown export ${field}`, fieldAst.span);
        return freshVar(env);
      }
      return instantiate(env, scheme);
    }
  }
  const objTy = applySubst(infer(env, obj, local, subst), subst);
  if (objTy.tag !== "nominal" || objTy.kind !== "record") {
    err(env, "E_TYPE_MISMATCH", `expected a record, found ${typeShow(objTy)}`, obj.span);
    return freshVar(env);
  }
  const def = env.types.get(objTy.name);
  if (!def || def.kind !== "record") {
    err(env, "E_TYPE_UNBOUND", `unknown record ${objTy.name}`, obj.span);
    return freshVar(env);
  }
  const found = def.fields.findIndex((f) => f.name === field);
  if (found < 0) {
    err(env, "E_TYPE_UNBOUND", `unknown field ${field}`, fieldAst.span);
    return freshVar(env);
  }
  const map = new Map<string, Type>();
  def.params.forEach((p, i) => {
    map.set(p, objTy.args[i] ?? { tag: "param", name: p });
  });
  return replaceParams(def.fields[found]!.type, map);
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
  // A missing else is lowered to (). () is Unit, so a missing else
  // typechecks only when every arm is Unit.
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
  // (let (tuple …) e [body…]) binds via the pattern
  if (ast.elems.length < 3) {
    err(env, "E_TYPE_LET", "let requires name and expression", ast.span);
    return freshVar(env);
  }
  const binder = ast.elems[1]!;
  const name = symStr(binder);
  const next = new Map(local);
  if (name) {
    const t = inferNamedExpr(env, name, ast.elems[2]!, local, subst);
    next.set(name, t);
    if (ast.elems.length === 3) return t;
    let last: Type = t;
    for (let i = 3; i < ast.elems.length; i++) {
      last = infer(env, ast.elems[i]!, next, subst);
    }
    return last;
  }
  const t = infer(env, ast.elems[2]!, local, subst);
  bindPattern(env, binder, t, next, subst, new Set());
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
      const binder = e.elems[1]!;
      const n = symStr(binder);
      const t = n ? inferNamedExpr(env, n, e.elems[2]!, loc, subst) : infer(env, e.elems[2]!, loc, subst);
      if (n) loc.set(n, t);
      else bindPattern(env, binder, t, loc, subst, new Set());
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

function inferNamedExpr(
  env: TypeEnv,
  name: string,
  expr: Ast,
  local: Map<string, Type>,
  subst: Subst,
): Type {
  if (expr.tag === "list" && (symStr(expr.elems[0]!) === "fn" || symStr(expr.elems[0]!) === "lambda")) {
    const tv = freshVar(env, name);
    const loc = new Map(local);
    loc.set(name, tv);
    const t = infer(env, expr, loc, subst);
    unify(env, tv, t, subst, expr.span);
    return applySubst(t, subst);
  }
  return infer(env, expr, local, subst);
}

/** `(fn params body)` or `(fn params -> ret body)`. */
function lambdaParts(
  ast: Ast & { tag: "list" },
): { params: Ast; body: Ast; ret: Ast | null } | null {
  if (ast.elems.length >= 5 && symStr(ast.elems[2]!) === "->") {
    return { params: ast.elems[1]!, ret: ast.elems[3]!, body: ast.elems[4]! };
  }
  if (ast.elems.length >= 3) {
    return { params: ast.elems[1]!, ret: null, body: ast.elems[2]! };
  }
  return null;
}

/** Bind one fn param; returns its type. Uses `expected` when provided. */
function bindLambdaParam(
  env: TypeEnv,
  p: Ast,
  local: Map<string, Type>,
  subst: Subst,
  expected: Type | null,
): Type {
  if (p.tag === "sym") {
    const n = symStr(p)!;
    const v = expected ?? freshVar(env, n);
    local.set(n, applySubst(v, subst));
    return applySubst(v, subst);
  }
  if (p.tag === "list" && symStr(p.elems[0]!) === "param" && p.elems[1] && p.elems[2]) {
    const ty = parseTypeExpr(env, p.elems[2]!, new Set());
    if (expected) expectType(env, ty, expected, subst, p.span);
    bindPattern(env, p.elems[1], applySubst(ty, subst), local, subst, new Set());
    return applySubst(ty, subst);
  }
  if (p.tag === "list" && p.elems[0]?.tag === "sym") {
    const raw = symStr(p.elems[0]!)!;
    if (raw.endsWith(":") && p.elems[1]) {
      const bare = raw.slice(0, -1);
      const ty = parseTypeExpr(env, p.elems[1], new Set());
      if (expected) expectType(env, ty, expected, subst, p.span);
      local.set(bare, applySubst(ty, subst));
      return applySubst(ty, subst);
    }
    if (raw === "tuple") {
      const v = expected ?? tProduct(p.elems.slice(1).map(() => freshVar(env)));
      if (expected) expectType(env, v, expected, subst, p.span);
      bindPattern(env, p, applySubst(v, subst), local, subst, new Set());
      return applySubst(v, subst);
    }
  }
  err(env, "E_TYPE_FN", "invalid fn parameter", p.span);
  return freshVar(env);
}

function checkLambdaAgainst(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  expected: Type,
  local: Map<string, Type>,
  subst: Subst,
): Type {
  const exp = applySubst(expected, subst);
  if (exp.tag !== "fn") {
    return inferLambda(env, ast, local, subst);
  }
  const parts = lambdaParts(ast);
  if (!parts) {
    err(env, "E_TYPE_FN", "fn requires params and body", ast.span);
    return freshVar(env);
  }
  const loc = new Map(local);
  const pts: Type[] = [];
  const pelems = parts.params.tag === "list" ? parts.params.elems : [];
  if (pelems.length !== exp.params.length) {
    err(
      env,
      "E_TYPE_ARITY",
      `function arity mismatch: expected ${exp.params.length}, found ${pelems.length}`,
      ast.span,
    );
  }
  for (let i = 0; i < pelems.length; i++) {
    pts.push(bindLambdaParam(env, pelems[i]!, loc, subst, exp.params[i] ?? null));
  }
  if (parts.ret) {
    const retTy = parseTypeExpr(env, parts.ret, new Set());
    expectType(env, retTy, exp.ret, subst, parts.ret.span);
    const body = infer(env, parts.body, loc, subst);
    expectType(env, body, retTy, subst, parts.body.span);
    return tFn(
      pts.map((p) => applySubst(p, subst)),
      applySubst(retTy, subst),
    );
  }
  const body = infer(env, parts.body, loc, subst);
  expectType(env, body, exp.ret, subst, parts.body.span);
  return tFn(
    pts.map((p) => applySubst(p, subst)),
    applySubst(exp.ret, subst),
  );
}

function inferLambda(
  env: TypeEnv,
  ast: Ast & { tag: "list" },
  local: Map<string, Type>,
  subst: Subst,
): Type {
  const parts = lambdaParts(ast);
  if (!parts) {
    err(env, "E_TYPE_FN", "fn requires params and body", ast.span);
    return freshVar(env);
  }
  const loc = new Map(local);
  const pts: Type[] = [];
  const pelems = parts.params.tag === "list" ? parts.params.elems : [];
  for (const p of pelems) {
    pts.push(bindLambdaParam(env, p, loc, subst, null));
  }
  if (parts.ret) {
    const retTy = parseTypeExpr(env, parts.ret, new Set());
    const body = infer(env, parts.body, loc, subst);
    expectType(env, body, retTy, subst, parts.body.span);
    return tFn(
      pts.map((p) => applySubst(p, subst)),
      applySubst(retTy, subst),
    );
  }
  const body = infer(env, parts.body, loc, subst);
  return tFn(
    pts.map((p) => applySubst(p, subst)),
    applySubst(body, subst),
  );
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
  if (scrut.tag === "product" && !hasWild && !covered.has("__product__")) {
    err(env, "E_TYPE_EXHAUSTIVE", "non-exhaustive match: missing product", ast.span);
  }

  return result ?? freshVar(env);
}

function bindRecordPat(
  env: TypeEnv,
  pat: Ast & { tag: "list" },
  scrut: Type,
  local: Map<string, Type>,
  subst: Subst,
  covered: Set<string>,
): void {
  const nameAst = pat.elems[1];
  const name = nameAst ? symStr(nameAst) : null;
  if (!name || !nameAst) {
    err(env, "E_TYPE_MISMATCH", "expected a record", pat.span);
    return;
  }
  const def = env.types.get(name);
  if (!def || def.kind !== "record") {
    err(env, "E_TYPE_MISMATCH", `expected a record, found ${name}`, pat.span);
    return;
  }
  const seen = new Set<string>();
  const wanted = new Set<string>();
  for (const f of pat.elems.slice(2)) {
    const n = symStr(f);
    if (!n) continue;
    if (seen.has(n)) {
      err(env, "E_TYPE_MISMATCH", `duplicate field ${n}`, f.span);
      continue;
    }
    seen.add(n);
    if (!def.fields.some((field) => field.name === n)) {
      err(env, "E_TYPE_UNBOUND", `unknown field ${n}`, f.span);
      continue;
    }
    wanted.add(n);
  }
  const enc = new TextEncoder();
  const elems: Ast[] = [nameAst];
  for (const field of def.fields) {
    const text = wanted.has(field.name) ? field.name : "_";
    elems.push({ tag: "sym", name: enc.encode(text), span: pat.span });
  }
  bindPattern(env, { tag: "list", kind: "paren", elems, span: pat.span }, scrut, local, subst, covered);
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
    if (n === "_") {
      if (applySubst(scrut, subst).tag === "product") covered.add("__product__");
      return;
    }
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
    if (applySubst(scrut, subst).tag === "product") covered.add("__product__");
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
  if (pat.tag === "list" && pat.elems.length === 2 && symStr(pat.elems[0]!) === "char") {
    expectType(env, scrut, prim("Char"), subst, pat.span);
    return;
  }
  if (pat.tag === "list" && pat.elems.length >= 1) {
    const cn = symStr(pat.elems[0]!);
    if (cn === "recpat") {
      bindRecordPat(env, pat, scrut, local, subst, covered);
      return;
    }
    if (cn === "tuple") {
      const elems = pat.elems.slice(1);
      if (elems.length < 2) {
        err(env, "E_TYPE_ARITY", "tuple pattern requires at least two parts", pat.span);
        return;
      }
      const expected = tProduct(elems.map(() => freshVar(env)));
      expectType(env, scrut, expected, subst, pat.span);
      const prod = applySubst(scrut, subst);
      if (prod.tag === "product") {
        if (prod.elems.length !== elems.length) {
          err(
            env,
            "E_TYPE_ARITY",
            `tuple pattern arity mismatch: expected ${prod.elems.length}, found ${elems.length}`,
            pat.span,
          );
        } else {
          for (let i = 0; i < elems.length; i++) {
            bindPattern(env, elems[i]!, prod.elems[i]!, local, subst, new Set());
          }
        }
      }
      covered.add("__product__");
      return;
    }
    if (cn === "guard" && pat.elems[1] && pat.elems[2]) {
      bindPattern(env, pat.elems[1], scrut, local, subst, covered);
      const gt = infer(env, pat.elems[2], local, subst);
      expectType(env, gt, prim("Bool"), subst, pat.elems[2].span);
      return;
    }
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
  const calleeFn = applySubst(callee, subst);
  const argAsts = ast.elems.slice(1);
  const args: Type[] = [];
  if (calleeFn.tag === "fn") {
    for (let i = 0; i < argAsts.length; i++) {
      const a = argAsts[i]!;
      const expected = calleeFn.params[i];
      if (
        expected &&
        a.tag === "list" &&
        a.kind === "paren" &&
        a.elems[0] !== undefined &&
        (symStr(a.elems[0]) === "fn" || symStr(a.elems[0]) === "lambda")
      ) {
        args.push(checkLambdaAgainst(env, a, expected, local, subst));
      } else {
        const got = infer(env, a, local, subst);
        if (expected) expectType(env, got, expected, subst, a.span);
        args.push(applySubst(got, subst));
      }
    }
  } else {
    for (const a of argAsts) {
      args.push(infer(env, a, local, subst));
    }
  }
  const ret = calleeFn.tag === "fn" ? applySubst(calleeFn.ret, subst) : freshVar(env);
  // unify callee with fn of arg types when not already a concrete Fn
  if (calleeFn.tag !== "fn") {
    if (!unify(env, callee, tFn(args, ret), subst, ast.span)) {
      // arity or argument mismatch already reported
    }
  } else if (argAsts.length !== calleeFn.params.length) {
    err(
      env,
      "E_TYPE_ARITY",
      `function arity mismatch: expected ${calleeFn.params.length}, found ${argAsts.length}`,
      ast.span,
    );
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
  if (hn === "empty" || hn === "set" || hn === "lookup") {
    // Map keys must be orderable — checked when key type known
  }
  return applySubst(ret, subst);
}
