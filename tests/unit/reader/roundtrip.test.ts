import { describe, expect, test } from "bun:test";
import {
  read,
  print,
  astEqual,
  type Ast,
} from "../../../host/src/reader/index.ts";

function mustRead(src: string | Uint8Array): Ast {
  const r = read(src);
  if (!r.ok) throw new Error(`parse failed: ${r.error.message}`);
  return r.ast;
}

function roundTrip(src: string | Uint8Array): void {
  const a = mustRead(src);
  const printed = print(a);
  const b = mustRead(printed);
  expect(astEqual(a, b)).toBe(true);
  // print is stable
  expect(print(b)).toEqual(printed);
}

describe("read/print round-trip", () => {
  test("empty list ()", () => {
    roundTrip("()");
    const ast = mustRead("()");
    expect(ast.tag).toBe("list");
    if (ast.tag === "list") {
      expect(ast.kind).toBe("paren");
      expect(ast.elems).toEqual([]);
      expect(ast.span.start).toBe(0);
      expect(ast.span.end).toBe(2);
    }
  });

  test("whitespace-only is an error for read", () => {
    const r = read("   \n  ; comment\n");
    expect(r.ok).toBe(false);
  });

  test("nested empty lists", () => {
    roundTrip("(())");
    roundTrip("(() ())");
  });
});
