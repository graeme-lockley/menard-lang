import { describe, expect, test } from "bun:test";
import {
  formatDiagnostic,
  parseErrorToDiagnostic,
  buildLineMap,
  offsetToLineCol,
} from "../../../host/src/diagnostic/index.ts";
import { read } from "../../../host/src/reader/index.ts";

describe("line map", () => {
  test("maps offsets to 1-based line/col in bytes", () => {
    const src = new TextEncoder().encode("ab\nc");
    const map = buildLineMap(src);
    expect(offsetToLineCol(map, 0)).toEqual({ line: 1, col: 1 });
    expect(offsetToLineCol(map, 2)).toEqual({ line: 1, col: 3 });
    expect(offsetToLineCol(map, 3)).toEqual({ line: 2, col: 1 });
  });

  test("invalid UTF-8 still yields stable columns", () => {
    const src = new Uint8Array([0x61, 0xff, 0x0a, 0x62]); // a\xff\\nb
    const map = buildLineMap(src);
    expect(offsetToLineCol(map, 1)).toEqual({ line: 1, col: 2 });
    expect(offsetToLineCol(map, 3)).toEqual({ line: 2, col: 1 });
  });
});

describe("formatDiagnostic", () => {
  test("formats a parse error with underline (golden)", () => {
    const source = "(a b\n";
    const r = read(source);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const diag = parseErrorToDiagnostic(r.error, "E_PARSE_UNCLOSED");
    const formatted = formatDiagnostic(diag, source, "ex.mnd");
    expect(formatted).toBe(
      [
        "ex.mnd:1:1: error[E_PARSE_UNCLOSED]: unclosed (",
        "  |",
        "1 | (a b",
        "  | ^^^^",
        "",
      ].join("\n"),
    );
  });

  test("formats with a note span", () => {
    const source = "(let x 1)\n(+ x)";
    const diag = {
      severity: "error" as const,
      category: "type" as const,
      code: "E_TYPE_ARITY",
      message: "expected 2 arguments, found 1",
      span: { start: 10, end: 14 },
      notes: [{ message: "x defined here", span: { start: 5, end: 6 } }],
    };
    const formatted = formatDiagnostic(diag, source, "t.mnd");
    expect(formatted).toContain("error[E_TYPE_ARITY]");
    expect(formatted).toContain("= note: x defined here");
    expect(formatted).toContain("1 | (let x 1)");
  });
});
