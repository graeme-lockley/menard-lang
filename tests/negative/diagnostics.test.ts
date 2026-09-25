import { describe, expect, test } from "bun:test";
import { diagnose } from "../../host/src/interp/index.ts";
import { formatDiagnostics } from "../../host/src/diagnostic/index.ts";

/** Byte-compared formatted diagnostics (Phase 1 acceptance). */
describe("negative diagnostics", () => {
  test("E_PARSE_UNCLOSED", () => {
    const src = "(defn f";
    const diags = diagnose(src);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.category).toBe("syntax");
    expect(formatDiagnostics(diags, src, "a.mnd")).toContain("error[E_PARSE_UNCLOSED]");
  });

  test("E_TYPE_MISMATCH formatted", () => {
    const src = "(+ 1 false)";
    const text = formatDiagnostics(diagnose(src), src, "b.mnd");
    expect(text).toBe(
      [
        "b.mnd:1:1: error[E_TYPE_MISMATCH]: expected Int, found Bool",
        "  |",
        "1 | (+ 1 false)",
        "  | ^^^^^^^^^^^",
        "",
      ].join("\n"),
    );
  });

  test("E_TYPE_EXHAUSTIVE names missing ctor", () => {
    const src = `(variant (Color) (Red) (Blue))
(defn f (c: Color) -> Int
  (match c
    (Red) 1))`;
    const diags = diagnose(src);
    const ex = diags.find((d) => d.code === "E_TYPE_EXHAUSTIVE");
    expect(ex).toBeDefined();
    expect(ex!.message).toContain("Blue");
    expect(ex!.category).toBe("type");
  });

  test("E_DESUGAR_COND_EMPTY", () => {
    const diags = diagnose("(cond)");
    expect(diags[0]!.code).toBe("E_DESUGAR_COND_EMPTY");
    expect(diags[0]!.category).toBe("semantic");
  });
});
