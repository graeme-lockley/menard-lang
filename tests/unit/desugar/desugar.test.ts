import { describe, expect, test } from "bun:test";
import { desugarAll } from "../../../host/src/desugar/index.ts";
import { readAll, print } from "../../../host/src/reader/index.ts";

function desugarSrc(src: string) {
  const r = readAll(src);
  if (!r.ok) throw new Error(r.error.message);
  return desugarAll(r.forms);
}

describe("desugar", () => {
  test("and desugars to if", () => {
    const r = desugarSrc("(and true false)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = new TextDecoder().decode(print(r.forms[0]!));
    expect(s).toContain("if");
  });

  function desugared(src: string): string {
    const r = desugarSrc(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return "";
    return new TextDecoder().decode(print(r.forms[0]!));
  }

  test("open-arity arithmetic, concat, and comparisons expand to binary calls", () => {
    expect(desugared("(+ 1 2)")).toBe("(+ 1 2)");
    expect(desugared("(+ 1)")).toBe("1");
    expect(desugared("(+ 1 2 3 4)")).toBe("(+ (+ (+ 1 2) 3) 4)");
    expect(desugared("(* 2 3 4)")).toBe("(* (* 2 3) 4)");
    expect(desugared("(str-concat \"a\" \"b\" \"c\")")).toBe(
      "(str-concat (str-concat \"a\" \"b\") \"c\")",
    );
    expect(desugared("(str-concat \"a\")")).toBe("\"a\"");
    expect(desugared("(- 10 3 2)")).toBe("(- (- 10 3) 2)");
    expect(desugared("(- 4)")).toBe("(- 0 4)");
    expect(desugared("(/ 8 4 2)")).toBe("(/ (/ 8 4) 2)");
    expect(desugared("(f+ 1.0 2.0 3.0)")).toBe("(f+ (f+ 1.0 2.0) 3.0)");
    expect(desugared("(f- 1.5)")).toBe("(f- 0.0 1.5)");
    expect(desugared("(< 1 2 3)")).toBe("(if (< 1 2) (< 2 3) false)");
    expect(desugared("(< 1 2 3 4)")).toBe("(if (< 1 2) (if (< 2 3) (< 3 4) false) false)");
    expect(desugared("(= 1 2 3)")).toBe("(if (= 1 2) (= 2 3) false)");
  });

  test("too few arguments is E_DESUGAR_ARITY", () => {
    for (const src of ["(+)", "(-)", "(str-concat)", "(/)", "(/ 1)", "(<)", "(< 1)", "(= 1)"]) {
      const r = desugarSrc(src);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.diagnostics[0]!.code).toBe("E_DESUGAR_ARITY");
    }
  });

  test("empty cond is a semantic error", () => {
    const r = desugarSrc("(cond)");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.diagnostics[0]!.code).toBe("E_DESUGAR_COND_EMPTY");
    expect(r.diagnostics[0]!.category).toBe("semantic");
  });

  test("when desugars", () => {
    const r = desugarSrc("(when true 1)");
    expect(r.ok).toBe(true);
  });

  test("a bracket list desugars to Cons/Nil, including inside match", () => {
    const r = desugarSrc("(match xs [] 0 [h t] (+ h t) _ (f [1 2]))");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = new TextDecoder().decode(print(r.forms[0]!));
    expect(s).toBe(
      "(match xs (Nil) 0 (Cons h (Cons t (Nil))) (+ h t) _ (f (Cons 1 (Cons 2 (Nil)))))",
    );
  });

  test("a type-parameter bracket is not a list literal", () => {
    const r = desugarSrc("(defn (id [a]) (x: a) -> a x)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = new TextDecoder().decode(print(r.forms[0]!));
    expect(s).toBe("(defn (id [a]) (x: a) -> a x)");
  });

  test("pub defn keeps its type-parameter bracket", () => {
    const r = desugarSrc("(pub defn (id [a]) (x: a) -> a x)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = new TextDecoder().decode(print(r.forms[0]!));
    expect(s).toBe("(pub defn (id [a]) (x: a) -> a x)");
  });
});
