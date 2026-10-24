import { describe, expect, test } from "bun:test";
import { typeDefId, typeEqual, typeShow, type Type, type TypeDef } from "../../../host/src/type/types.ts";
import { bindType, emptyEnv, parseTypeExpr } from "../../../host/src/type/check.ts";
import type { Ast } from "../../../host/src/reader/ast.ts";

const nominal = (id: string, name = "T"): Type => ({
  tag: "nominal",
  id,
  name,
  args: [],
  kind: "variant",
});

describe("canonical nominal identity", () => {
  test("same display name with different IDs does not unify", () => {
    const a = nominal("module-a::T");
    const b = nominal("module-b::T");
    expect(typeEqual(a, b)).toBe(false);
    expect(typeShow(a)).toBe("T");
    expect(typeShow(b)).toBe("T");
  });

  test("the same ID with a different display spelling unifies", () => {
    const a = nominal("module-a::T", "T");
    const b = nominal("module-a::T", "Alias.T");
    expect(typeEqual(a, b)).toBe(true);
    expect(typeShow(b)).toBe("Alias.T");
  });

  test("omitted ID falls back to the display name", () => {
    const a: Type = { tag: "nominal", name: "T", args: [], kind: "variant" };
    const b: Type = { tag: "nominal", name: "T", args: [], kind: "variant" };
    expect(typeEqual(a, b)).toBe(true);
  });
});

describe("TypeDef and constructor ownership identity", () => {
  const def = (id: string, name: string): TypeDef => ({
    kind: "variant",
    id,
    name,
    params: [],
    ctors: [],
    span: { start: 0, end: 0 },
  });

  test("TypeDef identity follows the id, not the display name", () => {
    expect(typeDefId(def("module-a::T", "T"))).not.toBe(typeDefId(def("module-b::T", "T")));
    expect(typeDefId(def("module-a::T", "T"))).toBe(typeDefId(def("module-a::T", "Alias.T")));
  });

  test("constructor owner identity follows the owner id", () => {
    const ctor = (typeId: string, typeName: string): Type => ({
      tag: "ctor",
      typeId,
      typeName,
      ctor: "A",
      payloads: [],
    });
    expect(typeEqual(ctor("module-a::T", "T"), ctor("module-b::T", "T"))).toBe(false);
    expect(typeEqual(ctor("module-a::T", "T"), ctor("module-a::T", "Alias.T"))).toBe(true);
    expect(typeShow(ctor("module-a::T", "Alias.T"))).toBe("A");
  });
});

describe("visible type spelling bindings", () => {
  const sym = (name: string): Ast => ({
    tag: "sym",
    name: new TextEncoder().encode(name),
    span: { start: 0, end: 0 },
  });

  const env = emptyEnv();
  env.types.set("module-a::T", {
    kind: "variant",
    id: "module-a::T",
    name: "T",
    params: [],
    ctors: [],
    span: { start: 0, end: 0 },
  });
  bindType(env, "A", "module-a::T");
  bindType(env, "B", "module-a::T");
  bindType(env, "C", "module-b::T");

  test("two visible spellings for one id produce equal nominals", () => {
    const a = parseTypeExpr(env, sym("A"), new Set());
    const b = parseTypeExpr(env, sym("B"), new Set());
    expect(typeEqual(a, b)).toBe(true);
    expect(typeEqual(a, parseTypeExpr(env, sym("C"), new Set()))).toBe(false);
  });
});
