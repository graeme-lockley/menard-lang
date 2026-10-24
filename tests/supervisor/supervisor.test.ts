/**
 * Build F — OTP-lite supervisor helpers (native).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

function runNative(fixture: string): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "menard-sup-"));
  const binary = join(dir, "out");
  try {
    const built = spawnSync(
      process.execPath,
      [
        "run",
        "host/src/cli/menard.ts",
        "run",
        "src/mn.mnd",
        "--",
        "build",
        fixture,
        "-o",
        binary,
        "--clean",
      ],
      { cwd: ROOT, encoding: "utf8", timeout: 180_000 },
    );
    if (built.status !== 0) {
      return { status: built.status, stdout: built.stdout, stderr: built.stderr };
    }
    const native = spawnSync(binary, [], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { status: native.status, stdout: native.stdout, stderr: native.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Build F supervisor", () => {
  test.skipIf(!Bun.which("clang"))(
    "native: Actor.Pid and Sup.Pid are one type",
    () => {
      const r = runNative("tests/supervisor/pid.mnd");
      expect(r.stderr).toBe("");
      expect(r.status).toBe(2);
    },
    { timeout: 180_000 },
  );

  test.skipIf(!Bun.which("clang"))(
    "native: start-children / restart / stop",
    () => {
      const r = runNative("tests/supervisor/basic.mnd");
      expect(r.stderr).not.toContain("panic");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("2\n2\n1\n1\n");
    },
    { timeout: 180_000 },
  );
});
