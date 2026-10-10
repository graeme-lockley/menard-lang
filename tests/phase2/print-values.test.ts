import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapNew, mapSet } from "../../host/src/builtins/collections.ts";
import { showValue } from "../../host/src/interp/derive.ts";
import { vBool, vInt, vStr, vVariant } from "../../host/src/interp/value.ts";

const ROOT = join(import.meta.dir, "../..");
const fixture = "tests/phase2/fixtures/print-values.mnd";
const expected = [
  'Input: [1,2], Tokens: [["1", "2"]]',
  "true false () -42 1.5",
  "(Point 7 true) (Red) (Rgb 1 2 3)",
  "[true, false] [[1, 2], [3]]",
  '(Some "hello") (Ok 42)',
  "computed",
  "(Box false) (Node true (Node false (Empty)))",
  '["a\\"b", "c\\\\d"]',
  "{1 => 10, 2 => 20}",
  '{"a" => true, "b" => false}',
  '"quoted"',
  "value0 value1 2",
  "[] [7] [[], [1]] (Box [true, false])",
  "",
].join("\n");

test("interpreter list representations share literal formatting", () => {
  expect(showValue({ tag: "list", elems: [vInt(1n), vInt(2n)] })).toBe("[1, 2]");
  expect(showValue(vVariant("Nil"))).toBe("[]");
  expect(showValue(vVariant("Cons", [
    vBool(true), { tag: "list", elems: [vBool(false)] },
  ]))).toBe("[true, false]");
  const m = mapSet(mapSet(mapNew(), vInt(2n), vInt(20n)), vInt(1n), vInt(10n));
  expect(showValue({ tag: "map", map: m })).toBe("{1 => 10, 2 => 20}");
  const keys = mapSet(mapNew(), vStr(new TextEncoder().encode("a")), vBool(true));
  expect(showValue({ tag: "map", map: keys })).toBe('{"a" => true}');
  expect(showValue({ tag: "map", map: mapNew() })).toBe("{}");
});

describe.skipIf(!Bun.which("clang"))("print and println value formatting", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "menard-print-values-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("interpreter and native output match actual values", () => {
    const interpreted = spawnSync(process.execPath, [
      "run", "host/src/cli/menard.ts", "run", fixture,
    ], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
    if (interpreted.error) throw interpreted.error;
    expect(interpreted.status).toBe(0);
    expect(interpreted.stdout).toBe(expected);

    const binary = join(dir, "print-values");
    const built = spawnSync(process.execPath, [
      "run", "host/src/cli/menard.ts", "run", "src/mn.mnd", "--",
      "build", fixture, "-o", binary, "--clean",
    ], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
    if (built.error) throw built.error;
    expect(built.stderr).not.toContain("error");
    expect(built.status).toBe(0);
    const native = spawnSync(binary, [], {
      cwd: ROOT, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, MENARD_GC_STRESS: "1", MENARD_HEAP_VERIFY: "1" },
    });
    if (native.error) throw native.error;
    expect(native.status).toBe(0);
    expect(native.stderr).toBe("");
    expect(native.stdout).toBe(expected);
  }, 120_000);
});
