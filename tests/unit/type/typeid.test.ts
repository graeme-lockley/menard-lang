import { describe, expect, test } from "bun:test";
import { typeEqual, typeShow, type Type } from "../../../host/src/type/types.ts";

const nominal = (id: string, name = "T"): Type => ({
  tag: "nominal",
  id,
  name,
  args: [],
  kind: "variant",
});

describe("canonical nominal identity", () => {
  test("same display name with different IDs does not unify", () => {
    const a = nominal("module-a::T");
    const b = nominal("module-b::T");
    expect(typeEqual(a, b)).toBe(false);
    expect(typeShow(a)).toBe("T");
    expect(typeShow(b)).toBe("T");
  });

  test("the same ID with a different display spelling unifies", () => {
    const a = nominal("module-a::T", "T");
    const b = nominal("module-a::T", "Alias.T");
    expect(typeEqual(a, b)).toBe(true);
    expect(typeShow(b)).toBe("Alias.T");
  });

  test("omitted ID falls back to the display name", () => {
    const a: Type = { tag: "nominal", name: "T", args: [], kind: "variant" };
    const b: Type = { tag: "nominal", name: "T", args: [], kind: "variant" };
    expect(typeEqual(a, b)).toBe(true);
  });
});
