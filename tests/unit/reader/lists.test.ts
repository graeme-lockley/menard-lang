import { describe, expect, test } from "bun:test";
import {
  read,
  readAll,
  print,
  astEqual,
  type Ast,
} from "../../../host/src/reader/index.ts";

function mustRead(src: string | Uint8Array): Ast {
  const r = read(src);
  if (!r.ok) throw new Error(`parse failed: ${r.error.message}`);
  return r.ast;
}

describe("lists", () => {
  test("infix call lowers to a paren", () => {
    const a = mustRead("1 + 2");
    expect(a.tag).toBe("list");
    if (a.tag === "list") {
      expect(a.kind).toBe("paren");
      expect(a.elems.length).toBe(3);
    }
    expect(astEqual(a, mustRead(new TextDecoder().decode(print(a))))).toBe(true);
  });

  test("bracket list distinct from a call", () => {
    const a = mustRead("[a, b]");
    expect(a.tag).toBe("list");
    if (a.tag === "list") {
      expect(a.kind).toBe("bracket");
      expect(a.elems.length).toBe(2);
    }
    const p = mustRead("a(b)");
    expect(astEqual(a, p)).toBe(false);
  });

  test("nested type parameters round-trip", () => {
    const src = "let tree-size[a](t: Tree a) -> Int = 0";
    const r = readAll(src);
    if (!r.ok) throw new Error(r.error.message);
    const printed = print(r.forms[0]!);
    const again = readAll(printed);
    if (!again.ok) throw new Error(again.error.message);
    expect(astEqual(r.forms[0]!, again.forms[0]!)).toBe(true);
  });

  test("unclosed paren is an error", () => {
    const r = read("(a");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("unclosed");
  });

  test("unclosed bracket is an error", () => {
    const r = read("[a");
    expect(r.ok).toBe(false);
  });
});
