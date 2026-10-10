import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe.skipIf(!Bun.which("clang"))("mn test --show-output", () => {
  let dir: string;
  let fixture: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "menard-test-output-"));
    fixture = join(dir, "output.test.mnd");
    writeFileSync(fixture, `test "passing output" = {
  println("debug from passing test")
  true
}

test "failing output" = {
  println("debug from failing test")
  false
}
`);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function runTests(flags: string[]) {
    const out = spawnSync(process.execPath, [
      "run", "host/src/cli/menard.ts", "run", "src/mn.mnd", "--",
      "test", fixture, ...flags,
    ], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
    if (out.error) throw out.error;
    expect(out.status).toBe(1);
    expect(out.stderr).toContain("assertion failed: failing output");
    expect(out.stdout).toMatch(/1 failed, 1 passed/);
    return out.stdout;
  }

  test("default output hides test stdout and individual results", () => {
    const text = runTests([]);
    expect(text).not.toContain("debug from");
    expect(text).not.toContain("pass passing output");
  }, 120_000);

  test("verbose output still hides test stdout", () => {
    const text = runTests(["--verbose"]);
    expect(text).not.toContain("debug from");
    expect(text).toContain("pass passing output");
    expect(text).toContain("fail failing output");
  }, 120_000);

  test("show-output reveals stdout next to each result in execution order", () => {
    const text = runTests(["--show-output"]);
    expect(text).toContain(
      "    debug from passing test\n  pass passing output\n" +
      "    debug from failing test\n  fail failing output\n",
    );
  }, 120_000);

  test("show-output composes with verbose without duplicating stdout", () => {
    const text = runTests(["--verbose", "--show-output"]);
    expect(text.split("debug from passing test")).toHaveLength(2);
    expect(text.split("debug from failing test")).toHaveLength(2);
    expect(text).toContain("pass passing output");
    expect(text).toContain("fail failing output");
  }, 120_000);
});
