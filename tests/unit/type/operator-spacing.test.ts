import { describe, expect, test } from "bun:test";
import { diagnose } from "../../../host/src/interp/index.ts";

describe("operator-spacing unbound help", () => {
  test("n+1 is E_TYPE_UNBOUND with spacing help and full span", () => {
    const src = "let x = n+1\n";
    const diags = diagnose(src);
    const d = diags.find((x) => x.code === "E_TYPE_UNBOUND");
    expect(d).toBeDefined();
    expect(d!.message).toBe("unbound variable n+1");
    expect(d!.help).toBe(
      "operators need a space on both sides; did you mean `n + 1`?",
    );
    expect(d!.span.start).toBe(src.indexOf("n+1"));
    expect(d!.span.end).toBe(src.indexOf("n+1") + 3);
  });

  test("suggest matrix: yes cases", () => {
    for (const [src, spaced] of [
      ["x-1", "x - 1"],
      ["i<n", "i < n"],
      ["a*b", "a * b"],
      ["f(x-1)", "x - 1"],
    ] as const) {
      const d = diagnose(src).find((x) => x.code === "E_TYPE_UNBOUND" && x.help);
      expect(d, src).toBeDefined();
      expect(d!.help).toContain(`\`${spaced}\``);
    }
  });

  test("suggest matrix: no false positives on unbound names", () => {
    // `f+` is a bound float intrinsic; the pure helper covers its rejection.
    // `g+` is unbound with a trailing op (empty right side) — no spacing help.
    for (const name of ["is-negative", "g+", "github:owner/repo@v1", "std/list", "f-1"]) {
      const d = diagnose(name).find(
        (x) => x.code === "E_TYPE_UNBOUND" && x.message.includes(name),
      );
      expect(d, name).toBeDefined();
      expect(d!.help).toBeUndefined();
    }
  });
});
