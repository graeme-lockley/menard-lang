import { describe, expect, test } from "bun:test";
import {
  formatInternalError,
  withInternalGuard,
} from "../../../host/src/cli/guard.ts";

describe("CLI internal error guard", () => {
  test("formatInternalError is a single line by default", () => {
    const err = new TypeError("undefined is not an object (evaluating 'scheme.params')");
    err.stack = "TypeError: …\n    at instantiate (host/src/type/check.ts:438:7)";
    expect(formatInternalError(err, false)).toBe(
      "internal error: undefined is not an object (evaluating 'scheme.params')\n",
    );
  });

  test("formatInternalError appends stack when requested", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n    at fake (x.ts:1:1)";
    const out = formatInternalError(err, true);
    expect(out.startsWith("internal error: boom\n")).toBe(true);
    expect(out).toContain("at fake (x.ts:1:1)");
  });

  test("withInternalGuard maps unexpected throws to exit 2", () => {
    let stderr = "";
    let code: number | undefined;
    withInternalGuard(
      () => {
        throw new TypeError("scheme.params");
      },
      {
        writeStderr: (s) => {
          stderr += s;
        },
        exit: (c) => {
          code = c;
        },
        showStack: false,
      },
    );
    expect(code).toBe(2);
    expect(stderr).toBe("internal error: scheme.params\n");
  });

  test("withInternalGuard does not catch a clean action", () => {
    let ran = false;
    let exited: number | undefined;
    withInternalGuard(
      () => {
        ran = true;
      },
      {
        writeStderr: () => {},
        exit: (c) => {
          exited = c;
        },
        showStack: false,
      },
    );
    expect(ran).toBe(true);
    expect(exited).toBeUndefined();
  });
});
