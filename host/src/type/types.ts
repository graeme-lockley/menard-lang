import type { Span } from "../reader/span.ts";

/** Canonical types (alias-expanded). Display names kept separately for diagnostics. */
export type Type =
  | { tag: "prim"; name: "Int" | "Float" | "Bool" | "Char" | "Str" | "Sym" | "Unit" | "StringBuffer" }
  | { tag: "var"; id: number; name?: string } // unification variable
  | { tag: "param"; name: string } // declared type parameter [a]
  | { tag: "list"; elem: Type }
  | { tag: "map"; key: Type; val: Type }
  | { tag: "maybe"; elem: Type }
  | { tag: "result"; ok: Type; err: Type }
  | { tag: "ref"; elem: Type }
  | { tag: "arr"; elem: Type; n: number | null }
  | { tag: "fn"; params: Type[]; ret: Type }
  | { tag: "nominal"; name: string; args: Type[]; kind: "record" | "variant" | "alias" }
  | { tag: "ctor"; typeName: string; ctor: string; payloads: Type[] }; // for patterns / values

export function prim(
  name: "Int" | "Float" | "Bool" | "Char" | "Str" | "Sym" | "Unit" | "StringBuffer",
): Type {
  return { tag: "prim", name };
}

export function tFn(params: Type[], ret: Type): Type {
  return { tag: "fn", params, ret };
}

export function tList(elem: Type): Type {
  return { tag: "list", elem };
}

export function tMaybe(elem: Type): Type {
  return { tag: "maybe", elem };
}

export function tResult(ok: Type, err: Type): Type {
  return { tag: "result", ok, err };
}

export function tRef(elem: Type): Type {
  return { tag: "ref", elem };
}

export function tMap(key: Type, val: Type): Type {
  return { tag: "map", key, val };
}

export function typeEqual(a: Type, b: Type): boolean {
  if (a.tag !== b.tag) return false;
  switch (a.tag) {
    case "prim":
      return b.tag === "prim" && a.name === b.name;
    case "var":
      return b.tag === "var" && a.id === b.id;
    case "param":
      return b.tag === "param" && a.name === b.name;
    case "list":
      return b.tag === "list" && typeEqual(a.elem, b.elem);
    case "map":
      return b.tag === "map" && typeEqual(a.key, b.key) && typeEqual(a.val, b.val);
    case "maybe":
      return b.tag === "maybe" && typeEqual(a.elem, b.elem);
    case "result":
      return b.tag === "result" && typeEqual(a.ok, b.ok) && typeEqual(a.err, b.err);
    case "ref":
      return b.tag === "ref" && typeEqual(a.elem, b.elem);
    case "arr":
      return b.tag === "arr" && a.n === b.n && typeEqual(a.elem, b.elem);
    case "fn":
      return (
        b.tag === "fn" &&
        a.params.length === b.params.length &&
        a.params.every((p, i) => typeEqual(p, b.params[i]!)) &&
        typeEqual(a.ret, b.ret)
      );
    case "nominal":
      return (
        b.tag === "nominal" &&
        a.name === b.name &&
        a.kind === b.kind &&
        a.args.length === b.args.length &&
        a.args.every((t, i) => typeEqual(t, b.args[i]!))
      );
    case "ctor":
      return (
        b.tag === "ctor" &&
        a.typeName === b.typeName &&
        a.ctor === b.ctor &&
        a.payloads.length === b.payloads.length &&
        a.payloads.every((t, i) => typeEqual(t, b.payloads[i]!))
      );
  }
}

/** Display spelling for diagnostics. */
export function typeShow(t: Type): string {
  switch (t.tag) {
    case "prim":
      return t.name;
    case "var":
      return t.name ?? `α${t.id}`;
    case "param":
      return t.name;
    case "list":
      return `(List ${typeShow(t.elem)})`;
    case "map":
      return `(Map ${typeShow(t.key)} ${typeShow(t.val)})`;
    case "maybe":
      return `(Maybe ${typeShow(t.elem)})`;
    case "result":
      return `(Result ${typeShow(t.ok)} ${typeShow(t.err)})`;
    case "ref":
      return `(Ref ${typeShow(t.elem)})`;
    case "arr":
      return `(Arr ${typeShow(t.elem)}${t.n === null ? "" : ` ${t.n}`})`;
    case "fn":
      return `(Fn ${t.params.map(typeShow).join(" ")} -> ${typeShow(t.ret)})`;
    case "nominal":
      return t.args.length === 0
        ? t.name
        : `(${t.name} ${t.args.map(typeShow).join(" ")})`;
    case "ctor":
      return t.payloads.length === 0
        ? t.ctor
        : `(${t.ctor} ${t.payloads.map(typeShow).join(" ")})`;
  }
}

export type Scheme = {
  params: string[];
  type: Type;
};

export type RecordField = { name: string; type: Type; span: Span };
export type VariantCtor = { name: string; payloads: Type[]; span: Span };

export type TypeDef =
  | { kind: "record"; name: string; params: string[]; fields: RecordField[]; span: Span }
  | { kind: "variant"; name: string; params: string[]; ctors: VariantCtor[]; span: Span }
  | { kind: "alias"; name: string; type: Type; span: Span };
