import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "../../..");
const HOST = join(ROOT, "host/src/cli/menard.ts");
const MN = join(ROOT, "mn");
const hasMn = existsSync(MN);
const MENARD_VERSION = readFileSync(join(ROOT, "VERSION"), "utf-8").trim();

const MENARD_LINE = new RegExp(
  `^menard ${MENARD_VERSION.replace(/\./g, "\\.")} \\([0-9a-f]+(?:, dirty)?\\)$`,
  "m",
);

function run(
  cmd: string,
  args: string[],
  cwd = ROOT,
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: "utf-8", cwd });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function assertVersionShape(stdout: string) {
  expect(stdout).toMatch(MENARD_LINE);
  expect(stdout).toMatch(/^built [0-9]{4}-[0-9]{2}-[0-9]{2}$/m);
  expect(stdout).toMatch(/^bun .+$/m);
  expect(stdout).toMatch(/^clang .+$/m);
  expect(stdout).toMatch(/^openssl .+$/m);
  expect(stdout).toMatch(/^llvm .+$/m);
  expect(stdout).toMatch(/^target .+$/m);
}

function assertToolchainShape(stdout: string) {
  expect(stdout).toMatch(/^cc: .+$/m);
  expect(stdout).toMatch(/^runtime include: .+$/m);
  expect(stdout).toMatch(/^runtime lib: .+$/m);
  expect(stdout).toMatch(/^bun: .+$/m);
  expect(stdout).toMatch(/^llvm: .+$/m);
  expect(stdout).toMatch(/^openssl include: .*$/m);
  expect(stdout).toMatch(/^openssl lib: .*$/m);
  expect(stdout).toMatch(/^openssl: .+$/m);
}

describe("CLI --version / --print-toolchain", () => {
  test("menard --version prints shape and exits 0", () => {
    const r = run("bun", [HOST, "--version"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    assertVersionShape(r.stdout);
    expect(r.stdout).toContain(`menard ${MENARD_VERSION} (`);
    expect(r.stdout).not.toMatch(/^project /m);
  });

  test("menard --version prints project line when project.mnd is present", () => {
    mkdirSync(join(ROOT, "build"), { recursive: true });
    const dir = mkdtempSync(join(ROOT, "build", "ver-proj-"));
    try {
      writeFileSync(join(dir, "project.mnd"), 'package "acme" @ "9.8.7"\n');
      const r = run("bun", [HOST, "--version"], dir);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe("");
      assertVersionShape(r.stdout);
      expect(r.stdout).toMatch(/^project acme 9.8.7$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("menard --print-toolchain prints labels and exits 0", () => {
    const r = run("bun", [HOST, "--print-toolchain"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    assertToolchainShape(r.stdout);
  });

  describe.skipIf(!hasMn)("native ./mn", () => {
    test("mn --version prints shape and exits 0", () => {
      const r = run(MN, ["--version"]);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe("");
      assertVersionShape(r.stdout);
      expect(r.stdout).toContain(`menard ${MENARD_VERSION} (`);
      expect(r.stdout).not.toMatch(/^project /m);
    });

    test("mn --version prints project line when project.mnd is present", () => {
      mkdirSync(join(ROOT, "build"), { recursive: true });
      const dir = mkdtempSync(join(ROOT, "build", "ver-proj-mn-"));
      try {
        writeFileSync(join(dir, "project.mnd"), 'package "acme" @ "9.8.7"\n');
        const r = run(MN, ["--version"], dir);
        expect(r.status).toBe(0);
        expect(r.stderr).toBe("");
        assertVersionShape(r.stdout);
        expect(r.stdout).toMatch(/^project acme 9.8.7$/m);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("mn --print-toolchain prints labels and exits 0", () => {
      const r = run(MN, ["--print-toolchain"]);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe("");
      assertToolchainShape(r.stdout);
    });
  });
});
