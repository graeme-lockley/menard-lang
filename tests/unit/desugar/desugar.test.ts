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
