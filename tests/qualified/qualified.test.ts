/**
 * LANG-04 — canonical type identity across qualified imports.
 * These are user-facing `check`/`build`/`run` paths (separate compilation).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

function runNative(fixture: string): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "menard-qualified-"));
  const binary = join(dir, "out");
  try {
    const built = spawnSync(
      process.execPath,
      ["run", "host/src/cli/menard.ts", "run", "src/mn.mnd", "--", "build", fixture, "-o", binary, "--clean"],
      { cwd: ROOT, encoding: "utf8", timeout: 180_000 },
    );
    if (built.status !== 0) return { status: built.status, stdout: built.stdout, stderr: built.stderr };
    const native = spawnSync(binary, [], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
    return { status: native.status, stdout: native.stdout, stderr: native.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function nativeCheck(fixture: string): { status: number | null; stderr: string } {
  const r = spawnSync(
    process.execPath,
    ["run", "host/src/cli/menard.ts", "run", "src/mn.mnd", "--", "check", fixture, "--clean"],
    { cwd: ROOT, encoding: "utf8", timeout: 180_000 },
  );
  return { status: r.status, stderr: r.stderr };
}

describe("canonical qualified types", () => {
  test.skipIf(!Bun.which("clang"))(
    "qualified local type and constructor run",
    () => {
      const r = runNative("tests/qualified/main.mnd");
      expect(r.stderr).toBe("");
      expect(r.status).toBe(7);
    },
    { timeout: 180_000 },
  );

  test.skipIf(!Bun.which("clang"))(
    "qualified imported nominal prints canonically",
    () => {
      const r = runNative("tests/qualified/json.mnd");
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("(JsonFloat 1.5)\n");
    },
    { timeout: 180_000 },
  );

  test.skipIf(!Bun.which("clang"))(
    "native value stubs survive canonicalization",
    () => {
      const r = runNative("tests/qualified/values.mnd");
      expect(r.stderr).toBe("");
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("x");
    },
    { timeout: 180_000 },
  );

  test(
    "unqualified constructor is rejected",
    () => {
      const r = nativeCheck("tests/qualified/json-bad.mnd");
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("E_TYPE_UNBOUND");
      expect(r.stderr).toContain("JsonFloat");
    },
    { timeout: 180_000 },
  );
});
