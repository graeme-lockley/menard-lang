import { describe, expect, test } from "bun:test";
import { diagnose } from "../../../host/src/interp/index.ts";

describe("E_TYPE_NULLARY_CALL", () => {
  test("None() is rejected with help", () => {
    const diags = diagnose("None()");
    const d = diags.find((x) => x.code === "E_TYPE_NULLARY_CALL");
    expect(d).toBeDefined();
    expect(d!.message).toContain("None");
    expect(d!.notes?.some((n) => n.message.includes("help:"))).toBe(true);
    expect(d!.notes?.some((n) => n.message.includes("None is a value"))).toBe(true);
  });

  test("user nullary Red() is rejected", () => {
    const src = `type Color =
  | Red
  | Blue

Red()
`;
    const diags = diagnose(src);
    const d = diags.find((x) => x.code === "E_TYPE_NULLARY_CALL");
    expect(d).toBeDefined();
    expect(d!.message).toContain("Red");
  });

  test("bare None and Some(1) still typecheck", () => {
    expect(diagnose("None")).toEqual([]);
    expect(diagnose("Some(1)")).toEqual([]);
  });
});
