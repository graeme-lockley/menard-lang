import { describe, expect, test } from "bun:test";
import {
  read,
  checkCasing,
} from "../../../host/src/reader/index.ts";

function mustRead(src: string) {
  const r = read(src);
  if (!r.ok) throw new Error(r.error.message);
  return r.ast;
}

describe("checkCasing", () => {
  test("valid defn", () => {
    const r = checkCasing(mustRead("(defn sign (n: Int) -> Str 0)"));
    expect(r.ok).toBe(true);
  });

  test("valid polymorphic defn", () => {
    const r = checkCasing(
      mustRead("(defn (tree-size [a]) (t: (Tree a)) -> Int 0)"),
    );
    expect(r.ok).toBe(true);
  });

  test("defn with Upper function name fails", () => {
    const r = checkCasing(mustRead("(defn Sign (n: Int) -> Int 0)"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("function name");
  });

  test("valid defrec", () => {
    const r = checkCasing(
      mustRead("(defrec (Pair [a b]) (fst: a) (snd: b))"),
    );
    expect(r.ok).toBe(true);
  });

  test("defrec with lower type name fails", () => {
    const r = checkCasing(mustRead("(defrec pair (fst: Int))"));
    expect(r.ok).toBe(false);
  });

  test("defrec with Upper field fails", () => {
    const r = checkCasing(mustRead("(defrec Pair (Fst: Int))"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("field name");
  });

  test("valid variant", () => {
    const r = checkCasing(
      mustRead(
        "(variant (Tree [a]) (Leaf a) (Node (Tree a) (Tree a)) (Empty))",
      ),
    );
    expect(r.ok).toBe(true);
  });

  test("variant with lower constructor fails", () => {
    const r = checkCasing(mustRead("(variant Tree (leaf Int))"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("variant constructor");
  });

  test("type params must be lower", () => {
    const r = checkCasing(mustRead("(defrec (Pair [A]) (fst: A))"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("type parameter");
  });

  test("valid alias", () => {
    const r = checkCasing(mustRead("(alias Ints (List Int))"));
    expect(r.ok).toBe(true);
  });

  test("alias with lower name fails", () => {
    const r = checkCasing(mustRead("(alias ints (List Int))"));
    expect(r.ok).toBe(false);
  });

  test("unknown heads are skipped", () => {
    const r = checkCasing(mustRead("(something Foo Bar)"));
    expect(r.ok).toBe(true);
  });
});
