/**
 * Build D dual-host acceptance for public Task.* and wait cells.
 * Observables only — not identical scheduler interleavings.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskResetForTests } from "../../host/src/interp/task.ts";

const ROOT = join(import.meta.dir, "../..");

function runInterpreter(fixture: string): { status: number | null; stdout: string; stderr: string } {
  taskResetForTests();
  const r = spawnSync(
    process.execPath,
    ["run", "host/src/cli/menard.ts", "run", fixture],
    { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function runNative(fixture: string): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "menard-task-"));
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
      env: {
        ...process.env,
        MENARD_GC_STRESS: "1",
        MENARD_HEAP_VERIFY: "1",
      },
    });
    return { status: native.status, stdout: native.stdout, stderr: native.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const BASIC_EXPECTED = "3\n2\n11\n1\n2\n";
/* notify-before, notify-after+notifier, multi-waiter acc, cancel saw, peer */
/* notify-before, notify-after+notifier, multi-waiter acc, cancel saw, peer,
 * notify-all sum, late wait on closed cell */
const WAIT_EXPECTED = "7\n7\n1\n11\n3\n7\n111\n1\n";
const DEADLINES_EXPECTED = "1\n2\n3\n4\n";

describe("Build D tasks", () => {
  test("interpreter: Task spawn/join/yield/cancel/scope", () => {
    const r = runInterpreter("tests/task/basic.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(BASIC_EXPECTED);
  });

  test("interpreter: wait-cell notify-before-wait", () => {
    const r = runInterpreter("tests/task/wait-cell.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(WAIT_EXPECTED);
  });

  test.skipIf(!Bun.which("clang"))(
    "native: Task API under GC stress",
    () => {
      const r = runNative("tests/task/basic.mnd");
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(BASIC_EXPECTED);
    },
  );

  test.skipIf(!Bun.which("clang"))(
    "native: wait-cell under GC stress",
    () => {
      const r = runNative("tests/task/wait-cell.mnd");
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(WAIT_EXPECTED);
    },
  );

  test("interpreter: sleep-ms and join-timeout (CONC-02)", () => {
    const r = runInterpreter("tests/task/deadlines.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(DEADLINES_EXPECTED);
  });

  test.skipIf(!Bun.which("clang"))(
    "native: sleep-ms and join-timeout (CONC-02)",
    () => {
      const r = runNative("tests/task/deadlines.mnd");
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(DEADLINES_EXPECTED);
    },
    { timeout: 180_000 },
  );
});
