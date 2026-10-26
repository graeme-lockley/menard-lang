/**
 * Build E dual-host acceptance for Mailbox + Actor.
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

function runNative(
  fixture: string,
  env: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "menard-actor-"));
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
      timeout: 120_000,
      env: { ...process.env, ...env },
    });
    return { status: native.status, stdout: native.stdout, stderr: native.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* sum sends, get ok, search count, notfound, registry get, death, escalate saw */
const BASIC_EXPECTED = "30\n1\n1\n0\n1\n1\n11\n";
const BOUNDED_EXPECTED = "1\n1\n5\n";
/* recv-dead, recv-other, send-dead, send-other, drain sum 10+20+1 */
const CLOSE_MANY_EXPECTED = "100\n0\n100\n0\n31\n";

describe("Build E actors", () => {
  test("interpreter: mailbox + Actor.call + death + registry + escalate", () => {
    const r = runInterpreter("tests/actor/basic.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(BASIC_EXPECTED);
  });

  test("interpreter: bounded mailbox block-on-full", () => {
    const r = runInterpreter("tests/actor/bounded.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(BOUNDED_EXPECTED);
  });

  test.skipIf(!Bun.which("clang"))(
    "native: actor acceptance",
    () => {
      const r = runNative("tests/actor/basic.mnd");
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(BASIC_EXPECTED);
    },
    { timeout: 180_000 },
  );

  test.skipIf(!Bun.which("clang"))(
    "native: bounded mailbox block-on-full",
    () => {
      const r = runNative("tests/actor/bounded.mnd");
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(BOUNDED_EXPECTED);
    },
    { timeout: 180_000 },
  );

  test("interpreter: close wakes every waiter (CONC-01)", () => {
    const r = runInterpreter("tests/actor/close-many-waiters.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(CLOSE_MANY_EXPECTED);
  }, 120_000);

  test.skipIf(!Bun.which("clang"))(
    "native: close wakes every waiter under GC stress (CONC-01)",
    () => {
      const r = runNative("tests/actor/close-many-waiters.mnd", {
        MENARD_GC_STRESS: "1",
        MENARD_HEAP_VERIFY: "1",
      });
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(CLOSE_MANY_EXPECTED);
    },
    { timeout: 300_000 },
  );
});
