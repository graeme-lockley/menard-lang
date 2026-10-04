import { describe, expect, test } from "bun:test";
import { desugarAll } from "../../../host/src/desugar/index.ts";
import { readAll, print } from "../../../host/src/reader/index.ts";

function desugarSrc(src: string) {
  const r = readAll(src);
  if (!r.ok) throw new Error(r.error.message);
  return desugarAll(r.forms);
}

function desugared(src: string): string {
  const r = desugarSrc(src);
  expect(r.ok).toBe(true);
  if (!r.ok) return "";
  return Buffer.from(print(r.forms[0]!)).toString("latin1");
}

describe("desugar", () => {
  test("and and or desugar to if", () => {
    expect(desugared("true && false")).toContain("if");
    expect(desugared("true || false")).toContain("if");
  });

  test("arithmetic, concat, and comparisons expand to binary calls", () => {
    expect(desugared("1 + 2")).toBe("1 + 2");
    expect(desugared("1 + 2 + 3 + 4")).toBe("1 + 2 + 3 + 4");
    expect(desugared("2 * 3 * 4")).toBe("2 * 3 * 4");
    expect(desugared('str-concat("a", "b", "c")')).toBe(
      'str-concat(str-concat("a", "b"), "c")',
    );
    expect(desugared('str-concat("a")')).toBe('"a"');
    expect(desugared("10 - 3 - 2")).toBe("10 - 3 - 2");
    expect(desugared("-(4)")).toBe("0 - 4");
    expect(desugared("8 / 4 / 2")).toBe("8 / 4 / 2");
    expect(desugared("f+(1.0, 2.0, 3.0)")).toBe("f+(f+(1.0, 2.0), 3.0)");
    expect(desugared("f-(1.5)")).toBe("f-(0.0, 1.5)");
    expect(desugared("1 < 2 < 3")).toBe("if (1 < 2) -> 2 < 3 | false");
    expect(desugared("1 < 2 < 3 < 4")).toBe(
      "cond\n  | 1 < 2 ->\n    if (2 < 3) -> 3 < 4 | false\n  | else -> false",
    );
    expect(desugared("1 == 2 == 3")).toBe("if (1 == 2) -> 2 == 3 | false");
  });

  test("a bracket list desugars to Cons/Nil, including inside match", () => {
    const s = desugared(`match (xs)
  | [] -> 0
  | [h, t] -> h + t
  | _ -> f([1, 2])`);
    expect(s).toBe(
      `match (xs)
  | Nil -> 0
  | h :: t :: Nil -> h + t
  | _ -> f(1 :: 2 :: Nil())`,
    );
  });

  test("a type-parameter bracket is not a list literal", () => {
    expect(desugared("let id[a](x: a) -> a =\n  x")).toBe("let id[a](x: a) -> a =\n  x");
  });

  test("pub let keeps its type-parameter bracket", () => {
    expect(desugared("pub let id[a](x: a) -> a =\n  x")).toBe("pub let id[a](x: a) -> a =\n  x");
  });
});
