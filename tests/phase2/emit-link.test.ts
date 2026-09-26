/**
 * Phase 2 (slices 2.7/2.8/2A) — emit → clang → run, end to end.
 *
 * `src/main.mnd emit` writes a bitcode module using the real bit-level
 * encoder in `src/emit/bc-writer.mnd` (slice 2A) — see that module's and
 * `src/emit/bitcode.mnd`'s header comments for what it does and does not
 * lower yet. This test checks that module is *actually valid LLVM
 * bitcode* by handing it to the pinned `clang` (ADR 40: the compiler
 * never shells out to `llvm-as` itself — only this test's harness does,
 * and only to link, not to assemble text) and running the resulting
 * binary. See `bc-writer.test.ts` for the checks specific to the
 * encoder itself (raw vs. wrapper magic).
 *
 * Not hermetic: this test spawns a real `clang` process and executes a
 * real binary, via Bun/Node APIs directly (not Menard's `spawn`, which is
 * unrelated). It is skipped rather than failed when `clang` is not on
 * `PATH`, so a host without the pinned LLVM/clang install does not fail
 * the suite — see README.md's "Prerequisites" for the version this was
 * developed against.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, unlink, mkdtemp } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../host/src/interp/pipeline.ts";
import { createLiveHost } from "../../host/src/host/index.ts";

const rm = promisify(unlink);
const mkdtempP = promisify(mkdtemp);

const ROOT = join(import.meta.dir, "../..");

function abs(relPath: string): string {
  return join(ROOT, relPath);
}

// Resolved once, the same way the Makefile resolves $(CC): looked up on
// PATH at run time, not hardcoded — see the Makefile's CC pin comment.
const clang = Bun.which("clang");

/** Run `src/main.mnd emit <entry> <out>` exactly as the CLI would. */
function emit(entryRelPath: string, outPath: string): { exitCode: number; stderr: string } {
  const entryPath = abs("src/main.mnd");
  const source = readFileSync(entryPath);
  const stderrChunks: Uint8Array[] = [];
  const host = createLiveHost({
    realFs: true,
    argv: ["emit", abs(entryRelPath), outPath],
    stdout: { write: () => {} },
    stderr: { write: (b: Uint8Array) => stderrChunks.push(b) },
  });
  const dec = new TextDecoder();
  const r = run(source, { path: entryPath, host });
  const stderr = stderrChunks.map((b) => dec.decode(b)).join("");
  if (r.ok) return { exitCode: r.exitCode ?? 0, stderr };
  if (r.kind === "diagnostics") {
    return { exitCode: 2, stderr: stderr + JSON.stringify(r.diagnostics) };
  }
  return { exitCode: 2, stderr: stderr + "[panic] " + r.message };
}

describe.skipIf(clang === null)("emit -> clang -> run (Goal B smoke)", () => {
  test("hello.mnd's emitted module links and exits 0", async () => {
    const dir = await mkdtempP(join(tmpdir(), "menard-emit-link-"));
    const bcPath = join(dir, "hello.bc");
    const binPath = join(dir, "hello");
    try {
      const emitted = emit("hello.mnd", bcPath);
      expect(emitted.stderr).toBe("");
      expect(emitted.exitCode).toBe(0);

      const link = spawnSync(clang!, [bcPath, "-o", binPath], { encoding: "utf-8" });
      expect(link.status).toBe(0);

      const ran = spawnSync(binPath, [], { encoding: "utf-8" });
      expect(ran.status).toBe(0);
    } finally {
      await rm(bcPath).catch(() => {});
      await rm(binPath).catch(() => {});
    }
  });
});
