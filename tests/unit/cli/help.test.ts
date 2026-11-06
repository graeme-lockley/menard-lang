import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "../../..");
const HOST = join(ROOT, "host/src/cli/menard.ts");
const MN = join(ROOT, "mn");
const hasMn = existsSync(MN);

function run(
  cmd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: "utf-8", cwd: ROOT });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

describe("CLI --help", () => {
  test("menard --help lists commands and exits 0", () => {
    const r = run("bun", [HOST, "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("check");
    expect(r.stdout).toContain("run");
    expect(r.stdout).toContain("fmt");
    expect(r.stderr).toBe("");
  });

  test("menard check --help prints check flags and exits 0", () => {
    const r = run("bun", [HOST, "check", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("usage: menard check");
    expect(r.stdout).toContain("--json");
  });

  test("menard --bogus exits 2 with a usage line", () => {
    const r = run("bun", [HOST, "--bogus"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage:");
  });

  describe.skipIf(!hasMn)("native ./mn", () => {
    test("mn --help lists commands and exits 0", () => {
      const r = run(MN, ["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("check");
      expect(r.stdout).toContain("run");
      expect(r.stdout).toContain("test");
      expect(r.stdout).toContain("fmt");
    });

    test("mn check --help prints check flags and exits 0", () => {
      const r = run(MN, ["check", "--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("usage: mn check");
      expect(r.stdout).toContain("--json");
    });

    test("mn --bogus exits 2 with a usage line", () => {
      const r = run(MN, ["--bogus"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("usage:");
    });
  });
});
