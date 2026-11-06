import { describe, expect, test } from "bun:test";
import { operatorSpacingHelp } from "../../../host/src/diagnostic/operator-spacing.ts";

describe("operatorSpacingHelp", () => {
  const yes: Array<[string, string]> = [
    ["n+1", "n + 1"],
    ["x-1", "x - 1"],
    ["i<n", "i < n"],
    ["a*b", "a * b"],
  ];

  for (const [name, spaced] of yes) {
    test(`suggests spacing for ${name}`, () => {
      const help = operatorSpacingHelp(name);
      expect(help).toBeDefined();
      expect(help).toContain(`\`${spaced}\``);
      expect(help).toContain("operators need a space on both sides");
    });
  }

  const no = ["is-negative", "f+", "github:owner/repo@v1", "std/list", "f-1"];

  for (const name of no) {
    test(`no suggestion for ${name}`, () => {
      expect(operatorSpacingHelp(name)).toBeUndefined();
    });
  }
});
