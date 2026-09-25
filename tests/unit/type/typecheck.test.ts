import { describe, expect, test } from "bun:test";
import { diagnose, run } from "../../../host/src/interp/index.ts";
import { formatDiagnostics } from "../../../host/src/diagnostic/index.ts";

describe("typer", () => {
  test("type mismatch reports E_TYPE_MISMATCH with span", () => {
    const src = `(defn f (x: Int) -> Int\n  "nope")`;
    const diags = diagnose(src);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some((d) => d.code === "E_TYPE_MISMATCH")).toBe(true);
    expect(diags[0]!.category).toBe("type");
    const formatted = formatDiagnostics(diags, src, "t.mnd");
    expect(formatted).toContain("error[E_TYPE_MISMATCH]");
    expect(formatted).toContain("t.mnd:");
  });

  test("unbound variable", () => {
    const diags = diagnose("(+ x 1)");
    expect(diags.some((d) => d.code === "E_TYPE_UNBOUND")).toBe(true);
  });

  test("if requires Bool", () => {
    const diags = diagnose("(if 1 2 3)");
    expect(diags.some((d) => d.code === "E_TYPE_MISMATCH")).toBe(true);
  });

  test("non-exhaustive match names missing ctor", () => {
    const src = `(variant (T)
  (A)
  (B))
(defn f (x: T) -> Int
  (match x
    (A) 1))`;
    const diags = diagnose(src);
    expect(diags.some((d) => d.code === "E_TYPE_EXHAUSTIVE")).toBe(true);
    expect(diags.find((d) => d.code === "E_TYPE_EXHAUSTIVE")!.message).toContain("B");
  });

  test("show rejects Ref", () => {
    const src = `(defn f () -> Str
  (show (ref 1)))`;
    const diags = diagnose(src);
    expect(diags.some((d) => d.code === "E_TYPE_SHOWABLE")).toBe(true);
  });
});

describe("pipeline diagnose", () => {
  test("syntax error stops before type", () => {
    const diags = diagnose("(a");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.category).toBe("syntax");
  });

  test("casing error", () => {
    const diags = diagnose("(defn Foo () -> Int 1)");
    expect(diags.some((d) => d.category === "casing")).toBe(true);
  });
});

describe("run", () => {
  test("evaluates arithmetic", () => {
    const r = run("(+ 2 3)");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tag).toBe("int");
      if (r.value.tag === "int") expect(r.value.value).toBe(5n);
    }
  });

  test("division by zero panics", () => {
    const r = run("(/ 1 0)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("panic");
  });

  test("defn and call", () => {
    const src = `(defn add1 (n: Int) -> Int
  (+ n 1))
(add1 41)`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(42n);
  });

  test("closures", () => {
    const src = `(defn adder (n: Int) -> (Fn Int -> Int)
  (fn (m) (+ n m)))
((adder 10) 7)`;
    // Fn type syntax might need adjustment - (Fn Int -> Int)
    const r = run(src);
    // May fail typecheck on Fn syntax - check
    if (!r.ok && r.kind === "diagnostics") {
      // try skip - actually fix Fn parse: (Fn Int -> Int) works in parseTypeExpr
    }
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(17n);
  });

  test("ref mutation", () => {
    const src = `(do
  (let r (ref 1))
  (set! r 2)
  (deref r))`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(2n);
  });

  test("match variants", () => {
    const src = `(variant (Tree)
  (Leaf Int)
  (Empty))
(defn sz (t: Tree) -> Int
  (match t
    (Empty) 0
    (Leaf _) 1))
(sz (Leaf 9))`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(1n);
  });
});
