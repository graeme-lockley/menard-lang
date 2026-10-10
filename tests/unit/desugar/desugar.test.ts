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

  test("arithmetic and comparisons expand to binary calls", () => {
    expect(desugared("1 + 2")).toBe("1 + 2");
    expect(desugared("1 + 2 + 3 + 4")).toBe("1 + 2 + 3 + 4");
    expect(desugared("2 * 3 * 4")).toBe("2 * 3 * 4");
    expect(desugared('concat("a", "b", "c")')).toBe('concat("a", "b", "c")');
    expect(desugared('concat("a")')).toBe('concat("a")');
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

  test("|> appends the left value as the last argument", () => {
    expect(desugared("tokens |> List.map(I.parse) |> List.filter(fn (n) = n <= 1000)")).toBe(
      "(List.filter)(fn (n) = n <= 1000, (List.map)(I.parse, tokens))",
    );
    expect(desugared("input |> String.drop(idx + 1) |> String.split-using(separators)")).toBe(
      "(String.split-using)(separators, (String.drop)(idx + 1, input))",
    );
    expect(desugared("numbers |> List.filter(is-negative) |> Err()")).toBe(
      "Err((List.filter)(is-negative, numbers))",
    );
    expect(desugared("numbers |> List.fold(fn (a, n) = a + n, 0)")).toBe(
      "(List.fold)(fn (a, n) = a + n, 0, numbers)",
    );
    expect(desugared("s |> String.drop(n)")).toBe("(String.drop)(n, s)");
    expect(desugared("s |> String.index-of-from(sep, i)")).toBe("(String.index-of-from)(sep, i, s)");
  });

  test("a map literal becomes map-set and a spread mentions map-keys once", () => {
    expect(desugared('{"a" => 1, "b" => 2}')).toBe('map-set(map-set(map-new(), "a", 1), "b", 2)');
    const spread = desugared("{...x, \"a\" => 1}");
    expect(spread.split("map-keys").length - 1).toBe(1);
    expect(spread).toContain("map-set");
  });

  test("question lowers to a match whose None arm holds the default", () => {
    const text = desugared('Some(1) ? panic("no")');
    expect(text).toContain("match (Some(1))");
    expect(text).toContain('| None -> panic("no")');
    expect(text).toContain("| Some(mn-ques) -> mn-ques");
  });

  test("a bare name is not a pipe target", () => {
    const r = desugarSrc("xs |> List.map");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diagnostics[0]?.code).toBe("E_DESUGAR_PIPE");
      expect(r.diagnostics[0]?.message).toBe("pipe expects a call");
    }
  });
});
