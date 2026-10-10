import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe.skipIf(!Bun.which("clang"))("mn test @test annotations", () => {
  let dir: string;
  let cache: string;
  let pass: string;
  let syntax: string;
  let typed: string;
  let assertFile: string;
  let missing: string;

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "menard-doctest-")));
    cache = realpathSync(mkdtempSync(join(tmpdir(), "menard-doctest-cache-")));
    const helper = join(dir, "helper.mnd");
    pass = join(dir, "pass.mnd");
    syntax = join(dir, "syntax.mnd");
    typed = join(dir, "typed.mnd");
    assertFile = join(dir, "assert.mnd");
    missing = join(dir, "missing.mnd");
    writeFileSync(helper, "pub let marker() -> Int = 7\n");
    writeFileSync(
      pass,
      `; @module ${pass}
; @test-import "./helper.mnd" as H
; @test-import std/map as Map
; @test kept(1) => 1
; @test kept(1) => 1
; @test H.marker() => 7
; @test Map.lookup(1, {1 => 2}) => Some(2)
; @test {
;   let inner = 1
;   kept(inner)
; } => 1
; @test exit(0)

pub let kept(n: Int) -> Int = n
`,
    );
    writeFileSync(
      syntax,
      `; @module ${pass}
; @test ] => 1
`,
    );
    writeFileSync(
      typed,
      `; @module ${pass}
; @test {
;   let inner = 1
;   kept("no")
; }
`,
    );
    writeFileSync(
      assertFile,
      `; @module ${pass}
; @test kept(1) => 2
`,
    );
    writeFileSync(missing, "; @test kept(1) => 1\n\npub let kept(n: Int) -> Int = n\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });

  function runTest(file: string, flags: string[] = []) {
    const out = spawnSync(
      process.execPath,
      ["run", "host/src/cli/menard.ts", "run", "src/mn.mnd", "--", "test", file, ...flags],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 180_000,
        env: { ...process.env, MENARD_CACHE: cache },
      },
    );
    if (out.error) throw out.error;
    return out;
  }

  function cacheMtimes(): Map<string, number> {
    const found = new Map<string, number>();
    const walk = (path: string) => {
      for (const name of readdirSync(path)) {
        const child = join(path, name);
        const st = statSync(child);
        if (st.isDirectory()) walk(child);
        else found.set(child, st.mtimeMs);
      }
    };
    walk(cache);
    return found;
  }

  test("reports against the original file and skips a rebuild", () => {
    const first = runTest(pass, ["--verbose"]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(`${pass.replace(/\.mnd$/, ".doctest.mnd")} ... ok`);
    expect(first.stdout).not.toContain("/doctest/");
    expect(first.stdout).toContain("pass kept(1) => 1 (line 5)");
    expect(first.stdout).not.toContain("exit");
    expect(first.stdout).toMatch(/5 passed/);

    const before = cacheMtimes();
    expect(before.size).toBeGreaterThan(0);
    const second = runTest(pass);
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/5 passed/);
    const after = cacheMtimes();
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, mtime] of before) {
      expect(after.get(path)).toBe(mtime);
    }

    const syntaxOut = runTest(syntax);
    expect(syntaxOut.status).toBe(1);
    expect(syntaxOut.stderr).toContain(`${syntax}:2:`);
    expect(syntaxOut.stderr).toContain("expected an expression");
    expect(syntaxOut.stderr).toContain("; @test ] => 1");
    expect(syntaxOut.stderr).not.toContain("/doctest/");

    const typeOut = runTest(typed);
    expect(typeOut.status).toBe(1);
    expect(typeOut.stderr).toContain(`${typed}:4:`);
    expect(typeOut.stderr).toContain(";   kept(\"no\")");
    expect(typeOut.stderr).not.toContain("/doctest/");

    const assertOut = runTest(assertFile);
    expect(assertOut.status).toBe(1);
    expect(assertOut.stdout).toContain(`${assertFile.replace(/\.mnd$/, ".doctest.mnd")} ... FAILED`);
    expect(assertOut.stdout).not.toContain("/doctest/");
    expect(assertOut.stderr).toContain(`${assertFile}:2:`);
    expect(assertOut.stderr).toContain("assertion failed: kept(1) => 2");
    expect(assertOut.stderr).toContain("; @test kept(1) => 2");
    expect(assertOut.stderr).not.toContain("/doctest/");

    const missingOut = runTest(missing);
    expect(missingOut.status).toBe(0);
    expect(missingOut.stdout).toContain(`${missing.replace(/\.mnd$/, ".doctest.mnd")} ... ok`);
    expect(missingOut.stdout).not.toContain("/doctest/");
  }, 180_000);
});
