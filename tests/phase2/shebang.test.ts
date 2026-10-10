/**
 * `mn <file.mnd> [arg…]` runs the file. Words after the path, including
 * ones that look like driver flags, are the program's arguments.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const fixture = "tests/phase2/fixtures/shebang.mnd";

describe.skipIf(!Bun.which("clang"))("script invocation", () => {
  test("a file path runs the program and forwards every following word", () => {
    const ran = spawnSync(process.execPath, [
      "run", "host/src/cli/menard.ts", "run", "src/mn.mnd", "--",
      fixture, "foo", "--clean",
    ], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
    if (ran.error) throw ran.error;
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe("2\nfoo\n--clean\n");
    expect(ran.stderr).not.toContain("error");
    expect(ran.stderr).not.toContain("usage:");
  }, 120_000);
});
