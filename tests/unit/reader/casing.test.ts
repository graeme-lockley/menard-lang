import { describe, expect, test } from "bun:test";
import {
  read,
  readAll,
  checkCasing,
} from "../../../host/src/reader/index.ts";

function mustRead(src: string) {
  const all = readAll(src);
  if (all.ok && all.forms.length > 0) return all.forms[0]!;
  const r = read(src);
  if (!r.ok) throw new Error(all.ok ? "empty" : all.error.message);
  return r.ast;
}

describe("checkCasing", () => {
  test("valid defn", () => {
    const r = checkCasing(mustRead("let sign(n: Int) -> Str = 0"));
    expect(r.ok).toBe(true);
  });

  test("valid polymorphic defn", () => {
    const r = checkCasing(
      mustRead("let tree-size[a](t: Tree a) -> Int = 0"),
    );
    expect(r.ok).toBe(true);
  });

  test("defn with Upper function name fails", () => {
    const r = checkCasing(mustRead("let Sign(n: Int) -> Int = 0"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("function name");
  });

  test("valid defrec", () => {
    const r = checkCasing(
      mustRead("record Pair[a, b] {\n  fst: a\n  snd: b\n}"),
    );
    expect(r.ok).toBe(true);
  });

  test("defrec with lower type name fails", () => {
    const r = checkCasing(mustRead("record pair {\n  fst: Int\n}"));
    expect(r.ok).toBe(false);
  });

  test("defrec with Upper field fails", () => {
    const r = checkCasing(mustRead("record Pair {\n  Fst: Int\n}"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("field name");
  });

  test("valid variant", () => {
    const r = checkCasing(
      mustRead(
        "type Tree[a] =\n  | Leaf(a)\n  | Node(Tree a, Tree a)\n  | Empty",
      ),
    );
    expect(r.ok).toBe(true);
  });

  test("variant with lower constructor fails", () => {
    const r = checkCasing(mustRead("type Tree =\n  | leaf(Int)"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("variant constructor");
  });

  test("type params must be lower", () => {
    const r = checkCasing(mustRead("record Pair[A] {\n  fst: A\n}"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("type parameter");
  });

  test("valid alias", () => {
    const r = checkCasing(mustRead("alias Ints = List Int"));
    expect(r.ok).toBe(true);
  });

  test("alias with lower name fails", () => {
    const r = checkCasing(mustRead("alias ints = List Int"));
    expect(r.ok).toBe(false);
  });

  test("unknown heads are skipped", () => {
    const r = checkCasing(mustRead("something(Foo, Bar)"));
    expect(r.ok).toBe(true);
  });
});
