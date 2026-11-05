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
    const source = "{";
    const r = read(source);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const diag = parseErrorToDiagnostic(r.error, "E_PARSE_UNCLOSED");
    const formatted = formatDiagnostic(diag, source, "ex.mnd");
    expect(formatted).toContain("error[E_PARSE_UNCLOSED]");
    expect(formatted).toContain("unclosed");
    expect(formatted).toContain("unclosed {");
  });

  test("formats with a note span", () => {
    const source = "let x = 1\nx";
    const diag = {
      severity: "error" as const,
      category: "type" as const,
      code: "E_TYPE_ARITY",
      message: "expected 2 arguments, found 1",
      span: { start: 11, end: 12 },
      notes: [{ message: "x defined here", span: { start: 4, end: 5 } }],
    };
    const formatted = formatDiagnostic(diag, source, "t.mnd");
    expect(formatted).toContain("error[E_TYPE_ARITY]");
    expect(formatted).toContain("= note: x defined here");
    expect(formatted).toContain("1 | let x = 1");
  });

  test("formats help after the caret block", () => {
    const source = "None()";
    const diag = {
      severity: "error" as const,
      category: "type" as const,
      code: "E_TYPE_NULLARY_CALL",
      message: "nullary constructor None cannot be called",
      span: { start: 0, end: 6 },
      help: "remove the parentheses; None is a value",
    };
    const formatted = formatDiagnostic(diag, source, "t.mnd");
    expect(formatted).toContain("error[E_TYPE_NULLARY_CALL]");
    expect(formatted).toContain("help: remove the parentheses; None is a value");
    const helpIdx = formatted.indexOf("help:");
    const caretIdx = formatted.lastIndexOf("^");
    expect(helpIdx).toBeGreaterThan(caretIdx);
  });

  test("text help for orderable, arity, and unbound constructor", () => {
    const orderable = formatDiagnostic(
      {
        severity: "error",
        category: "type",
        code: "E_TYPE_ORDERABLE",
        message: "type (Fn x -> x) is not orderable",
        span: { start: 0, end: 8 },
        help: "only Int, Float, Str, Char, Bool, and variants of those are orderable",
      },
      "compare(fn (x) = x, fn (y) = y)",
      "o.mnd",
    );
    expect(orderable).toContain("help: only Int, Float, Str, Char, Bool");

    const arity = formatDiagnostic(
      {
        severity: "error",
        category: "type",
        code: "E_TYPE_ARITY",
        message: "function arity mismatch: expected 2, found 1",
        span: { start: 0, end: 4 },
        help: "check the call: expected and found argument counts must match",
      },
      "f(1)",
      "a.mnd",
    );
    expect(arity).toContain("help: check the call: expected and found argument counts must match");

    const unbound = formatDiagnostic(
      {
        severity: "error",
        category: "type",
        code: "E_TYPE_UNBOUND",
        message: "unknown constructor",
        span: { start: 0, end: 8 },
        help: "check the spelling, or qualify the constructor with its import alias",
      },
      "NoSuch(x)",
      "u.mnd",
    );
    expect(unbound).toContain(
      "help: check the spelling, or qualify the constructor with its import alias",
    );
  });
});
