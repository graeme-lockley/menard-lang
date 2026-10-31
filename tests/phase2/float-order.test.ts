/**
 * LANG-03: monotonic Float order keys, NaN canonicalisation, and host
 * compareValue agreement with the C transform.
 */
import { describe, expect, test } from "bun:test";
import {
  canonicalFloat,
  compareFloat,
  floatBits,
  floatOrderKey,
} from "../../host/src/interp/float-order.ts";
import { compareValue, equalValue, showValue } from "../../host/src/interp/derive.ts";
import { diagnose } from "../../host/src/interp/index.ts";
import { run } from "../../host/src/interp/pipeline.ts";
import { createLiveHost } from "../../host/src/host/index.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const CANON_NAN = 0x7ff8000000000000n;

describe("float-order (LANG-03)", () => {
  test("canonicalFloat maps every NaN to the quiet payload", () => {
    expect(floatBits(canonicalFloat(NaN))).toBe(CANON_NAN);
    expect(floatBits(canonicalFloat(0 / 0))).toBe(CANON_NAN);
    expect(floatBits(canonicalFloat(Number.NaN))).toBe(CANON_NAN);
    expect(Object.is(canonicalFloat(-0), -0)).toBe(true);
    expect(Object.is(canonicalFloat(0), 0)).toBe(true);
  });

  test("compareFloat matches the acceptance order", () => {
    expect(compareFloat(1, 2)).toBe(-1);
    expect(compareFloat(-1, 1)).toBe(-1);
    expect(compareFloat(-0, 0)).toBe(-1);
    expect(compareFloat(NaN, NaN)).toBe(0);
    expect(compareFloat(Infinity, NaN)).toBe(-1);
    expect(compareFloat(-Infinity, 1)).toBe(-1);
    expect(compareFloat(1, Infinity)).toBe(-1);
  });

  test("compareValue / equalValue agree with bit equality", () => {
    const nan = { tag: "float" as const, value: canonicalFloat(NaN) };
    const ninf = { tag: "float" as const, value: -Infinity };
    const z = { tag: "float" as const, value: 0 };
    const nz = { tag: "float" as const, value: -0 };
    expect(compareValue(nan, nan)).toBe(0);
    expect(equalValue(nan, nan)).toBe(true);
    expect(compareValue(ninf, nan)).toBe(-1);
    expect(compareValue(nz, z)).toBe(-1);
    expect(equalValue(nz, z)).toBe(false);
    expect(showValue(nan)).toBe("nan");
    expect(showValue(nz)).toBe("-0.0");
    expect(showValue(z)).toBe("0.0");
  });

  test("order keys are strictly increasing along the sample chain", () => {
    const chain = [-Infinity, -2, -0, 0, 1, Infinity, NaN].map(canonicalFloat);
    for (let i = 0; i < chain.length - 1; i++) {
      expect(floatOrderKey(chain[i]!) < floatOrderKey(chain[i + 1]!)).toBe(true);
    }
  });

  test("host accepts compare(1.0, 2.0) and rejects Ref compare", () => {
    const ok = diagnose(
      new TextEncoder().encode("let main() -> Int { compare(1.0, 2.0) }"),
      { path: "x" },
    );
    expect(ok).toEqual([]);
    const bad = diagnose(
      new TextEncoder().encode("let main() -> Int { compare(ref(1), ref(2)) }"),
      { path: "x" },
    );
    expect(bad.some((d) => d.code === "E_TYPE_ORDERABLE")).toBe(true);
  });

  test("interpreter runs the corpus program", () => {
    const path = join(ROOT, "tests/corpus/float-order.mnd");
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
    expect(text).toContain("-1\n");
    expect(text).toContain("[-2.0, -1.0, 0.0, 1.0, 2.0]\n");
    expect(text).toContain("[-inf, 1.0, nan]\n");
    expect(text).toContain("true\n");
    expect(text).toContain("false\n");
  });
});
