/**
 * Build F — language defer (interpreter).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
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

describe("Build F defer", () => {
  test("interpreter: LIFO + cancel cleanup", () => {
    const r = runInterpreter("tests/defer/basic.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("321\n1\n");
  });
});
