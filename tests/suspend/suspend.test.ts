/**
 * Build C §3.5.1 dual-host acceptance.
 * Observables only — not identical scheduler interleavings.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskResetForTests } from "../../host/src/interp/task.ts";

const ROOT = join(import.meta.dir, "../..");
const fixture = "tests/suspend/nested.mnd";
const EXPECTED = "141\n2\n41\n";

function runInterpreter(): { status: number | null; stdout: string; stderr: string } {
  taskResetForTests();
  const r = spawnSync(
    process.execPath,
    ["run", "host/src/cli/menard.ts", "run", fixture],
    { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("Build C suspension", () => {
  test("interpreter: nested suspend, shared Ref, join", () => {
    const r = runInterpreter();
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(EXPECTED);
  });

  test.skipIf(!Bun.which("clang"))(
    "native: nested suspend, shared Ref, join under GC stress",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "menard-suspend-"));
      const binary = join(dir, "nested");
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
        expect(built.status).toBe(0);
        expect(built.stderr).not.toContain("error");

        const native = spawnSync(binary, [], {
          cwd: ROOT,
          encoding: "utf8",
          timeout: 60_000,
          env: {
            ...process.env,
            MENARD_GC_STRESS: "1",
            MENARD_HEAP_VERIFY: "1",
          },
        });
        expect(native.stderr).toBe("");
        expect(native.status).toBe(0);
        expect(native.stdout).toBe(EXPECTED);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
