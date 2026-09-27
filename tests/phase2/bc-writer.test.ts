/**
 * Phase 2 slice 2A — the real bit-level LLVM bitcode encoder
 * (`src/emit/bc-writer.mnd`), wired into `src/main.mnd emit` via
 * `src/emit/bitcode.mnd`.
 *
 * Checks that `menard emit`'s output is:
 *   - actual, valid LLVM bitcode: handed to the pinned `clang` (ADR 40 —
 *     this test's harness is the one place that shells to clang to
 *     *link*, never `llvm-as` to *assemble*) and run, it must exit 0;
 *   - **raw** bitcode, never Darwin-wrapped: it must start with the
 *     bitstream magic (`BC\xC0\xDE`) directly, and must *not* start with
 *     the wrapper header magic (`\xDE\xC0\x17\x0B`) that
 *     `runtime/fixtures/ret0.bc` — clang's own `-emit-llvm` output on
 *     this toolchain — starts with (see that fixture's header comment).
 *
 * Not hermetic: spawns a real `clang` process and executes a real
 * binary. Skipped rather than failed when `clang` is not on `PATH` (see
 * `emit-link.test.ts`'s equivalent skip).
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

const clang = Bun.which("clang");

// `hello.mnd` now calls into the runtime's fd-1 print helpers
// (`println` lowering, slice adding string-global support) — linking the
// bare `.bc` alone (as this test did before that slice) leaves
// `mn_write_stdout`/`mn_print_i64`/`mn_write_stderr` undefined; link
// against the same runtime `oracle.test.ts` does.
const RUNTIME_LIB_SRCS = [
  "runtime/src/alloc.c",
  "runtime/src/panic.c",
  "runtime/src/print.c",
  "runtime/src/shadow.c",
  "runtime/src/variants.c",
  "runtime/src/str.c",
  "runtime/src/map.c",
  "runtime/src/closure.c",
  "runtime/src/io.c",
].map(abs);
const RUNTIME_INCLUDE = abs("runtime/include");

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

const BITSTREAM_MAGIC = Buffer.from([0x42, 0x43, 0xc0, 0xde]); // 'B' 'C' 0xC0 0xDE
const WRAPPER_MAGIC = Buffer.from([0xde, 0xc0, 0x17, 0x0b]); // 0x0B17C0DE, little-endian

describe.skipIf(clang === null)("src/emit/bc-writer.mnd — a real bitcode encoder", () => {
  test("emits raw (unwrapped) bitcode: starts with BC\\xC0\\xDE, not the Darwin wrapper", async () => {
    const dir = await mkdtempP(join(tmpdir(), "menard-bc-writer-"));
    const bcPath = join(dir, "hello.bc");
    try {
      const emitted = emit("hello.mnd", bcPath);
      expect(emitted.stderr).toBe("");
      expect(emitted.exitCode).toBe(0);

      const bytes = readFileSync(bcPath);
      expect(bytes.subarray(0, 4).equals(BITSTREAM_MAGIC)).toBe(true);
      expect(bytes.subarray(0, 4).equals(WRAPPER_MAGIC)).toBe(false);
    } finally {
      await rm(bcPath).catch(() => {});
    }
  });

  test("clang links and runs the emitted module, exiting 0", async () => {
    const dir = await mkdtempP(join(tmpdir(), "menard-bc-writer-"));
    const bcPath = join(dir, "hello.bc");
    const binPath = join(dir, "hello");
    try {
      const emitted = emit("hello.mnd", bcPath);
      expect(emitted.exitCode).toBe(0);

      const link = spawnSync(
        clang!,
        [bcPath, ...RUNTIME_LIB_SRCS, "-I", RUNTIME_INCLUDE, "-o", binPath],
        { encoding: "utf-8" },
      );
      expect(link.status).toBe(0);

      const ran = spawnSync(binPath, [], { encoding: "utf-8" });
      expect(ran.status).toBe(0);
      expect(ran.stdout).toBe("Hello, world!\n");
    } finally {
      await rm(bcPath).catch(() => {});
      await rm(binPath).catch(() => {});
    }
  });
});
