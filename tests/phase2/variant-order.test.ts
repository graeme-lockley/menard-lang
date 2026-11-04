/**
 * LANG-18: variant constructor order is declaration-order numeric tags
 * (matching native), not alphabetical ctor names. Hardcoded expects so
 * host/native agreement alone cannot preserve a shared wrong answer.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { compareValue } from "../../host/src/interp/derive.ts";
import {
  ctorTag,
  registerUserCtor,
  resetUserCtorTags,
} from "../../host/src/interp/ctor-tags.ts";
import { vInt, vVariant } from "../../host/src/interp/value.ts";
import { diagnose } from "../../host/src/interp/index.ts";
import { run } from "../../host/src/interp/pipeline.ts";
import { createLiveHost } from "../../host/src/host/index.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("variant-order (LANG-18)", () => {
  beforeEach(() => {
    resetUserCtorTags();
  });

  test("builtins: Ok < Err by tag (alphabetical would invert)", () => {
    expect(ctorTag("Ok")).toBe(4);
    expect(ctorTag("Err")).toBe(5);
    const ok = vVariant("Ok", [vInt(1n)]);
    const err = vVariant("Err", [vInt(1n)]);
    expect(compareValue(ok, err)).toBe(-1);
    expect(compareValue(err, ok)).toBe(1);
  });

  test("builtins: None < Some by tag", () => {
    expect(ctorTag("None")).toBe(2);
    expect(ctorTag("Some")).toBe(3);
    expect(compareValue(vVariant("None"), vVariant("Some", [vInt(0n)]))).toBe(-1);
  });

  test("user ctors: declaration order Z before A (alphabetical would invert)", () => {
    registerUserCtor("Z");
    registerUserCtor("A");
    registerUserCtor("B");
    expect(ctorTag("Z")).toBe(1000);
    expect(ctorTag("A")).toBe(1001);
    expect(ctorTag("B")).toBe(1002);
    expect(compareValue(vVariant("Z"), vVariant("A"))).toBe(-1);
    expect(compareValue(vVariant("A"), vVariant("Z"))).toBe(1);
    expect(compareValue(vVariant("Z"), vVariant("B", [vInt(1n)]))).toBe(-1);
    expect(compareValue(vVariant("A"), vVariant("B", [vInt(0n)]))).toBe(-1);
  });

  test("same ctor: payload order then length", () => {
    registerUserCtor("B");
    expect(compareValue(vVariant("B", [vInt(1n)]), vVariant("B", [vInt(2n)]))).toBe(-1);
    expect(compareValue(vVariant("B", [vInt(1n)]), vVariant("B", [vInt(1n)]))).toBe(0);
  });

  test("nested variants use outer then inner tag order", () => {
    // Outer declared Wrap then Box; Inner declared Z then A.
    registerUserCtor("Wrap");
    registerUserCtor("Box");
    registerUserCtor("Z");
    registerUserCtor("A");
    const wrapZ = vVariant("Wrap", [vVariant("Z")]);
    const wrapA = vVariant("Wrap", [vVariant("A")]);
    const boxZ = vVariant("Box", [vVariant("Z")]);
    // Wrap < Box by declaration (alphabetical: Box < Wrap).
    expect(compareValue(wrapZ, boxZ)).toBe(-1);
    expect(compareValue(wrapZ, wrapA)).toBe(-1);
  });

  test("interpreter runs the corpus program with fixed expects", () => {
    const path = join(ROOT, "tests/corpus/variant-order.mnd");
    const source = readFileSync(path);
    const stdout: Uint8Array[] = [];
    const host = createLiveHost({
      realFs: true,
      argv: [],
      stdout: { write: (b) => stdout.push(b) },
      stderr: { write: () => {} },
    });
    const r = run(source, { path, host });
    expect(r.ok).toBe(true);
    const text = stdout.map((b) => new TextDecoder().decode(b)).join("");
    // compare signs: Z < A, Ok < Err, None < Some, Wrap(Z) < Box(Z)
    expect(text).toContain("-1\n");
    // List.sort of reverse-alpha nullary+payload
    expect(text).toContain("[Z, A, (B 1), (C 1 2)]\n");
    // Map.keys in declaration tag order (Z first, not A)
    expect(text).toContain("[Z, A, (B 1), (C 1 0)]\n");
    // Map replacement keeps one B(1) entry (lookup wraps Some)
    expect(text).toContain('(Some "replaced")\n');
    expect(text).toContain('(Some "z")\n');
    expect(text).toContain("[None, (Some 1)]\n");
    expect(text).toContain("[(Ok 0), (Err 0)]\n");
    expect(text).toContain("[(Wrap Z2), (Wrap A2), (Box A2)]\n");
  });

  test("host accepts compare of reverse-order variants", () => {
    const ok = diagnose(
      new TextEncoder().encode(
        "type T =\n  | Z\n  | A\nlet main() -> Int { compare(Z, A) }\n",
      ),
      { path: "x" },
    );
    expect(ok).toEqual([]);
  });
});
