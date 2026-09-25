import type { Span } from "./span.ts";

export type ListKind = "paren" | "bracket";

export type Ast =
  | { tag: "list"; kind: ListKind; elems: Ast[]; span: Span }
  | { tag: "sym"; name: Uint8Array; span: Span }
  | { tag: "int"; value: bigint; span: Span }
  | { tag: "float"; value: number; span: Span }
  | { tag: "str"; bytes: Uint8Array; span: Span }
  | { tag: "bool"; value: boolean; span: Span };

export function astSpan(ast: Ast): Span {
  return ast.span;
}

/** Structural equality ignoring spans. */
export function astEqual(a: Ast, b: Ast): boolean {
  if (a.tag !== b.tag) return false;
  switch (a.tag) {
    case "list":
      return (
        b.tag === "list" &&
        a.kind === b.kind &&
        a.elems.length === b.elems.length &&
        a.elems.every((e, i) => astEqual(e, b.elems[i]!))
      );
    case "sym":
      return b.tag === "sym" && bytesEqual(a.name, b.name);
    case "int":
      return b.tag === "int" && a.value === b.value;
    case "float":
      return (
        b.tag === "float" &&
        Object.is(a.value, b.value) // distinguishes −0 from +0
      );
    case "str":
      return b.tag === "str" && bytesEqual(a.bytes, b.bytes);
    case "bool":
      return b.tag === "bool" && a.value === b.value;
  }
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const enc = new TextEncoder();

export function symName(s: string): Uint8Array {
  return enc.encode(s);
}

export function nameEquals(name: Uint8Array, ascii: string): boolean {
  if (name.length !== ascii.length) return false;
  for (let i = 0; i < name.length; i++) {
    if (name[i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}
