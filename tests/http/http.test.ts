/**
 * Build F — HTTP server + client round-trip (native only).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

function runNative(fixture: string): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "menard-http-"));
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

describe("Build F http", () => {
  test.skipIf(!Bun.which("clang"))(
    "native: HTTP server + client round-trip",
    () => {
      const r = runNative("tests/http/roundtrip.mnd");
      expect(r.stderr).not.toContain("panic");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("200\n/hi\n");
    },
    { timeout: 180_000 },
  );
});
