/**
 * Native spawn-capture. The only oracle case that starts a real child.
 * Hermetic fixtures stay in tests/phase2/oracle.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlink, mkdtemp } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../host/src/interp/pipeline.ts";
import { createLiveHost } from "../../host/src/host/index.ts";

const rm = promisify(unlink);
const mkdtempP = promisify(mkdtemp);
const ROOT = join(import.meta.dir, "..", "..");

function abs(relPath: string): string {
  return join(ROOT, relPath);
}

function whichTool(name: string): string | null {
  const onPath = Bun.which(name);
  if (onPath !== null) return onPath;
  for (const prefix of ["/opt/homebrew/opt/llvm/bin", "/usr/local/opt/llvm/bin"]) {
    const candidate = join(prefix, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const clang = whichTool("clang");
const llvmDis = whichTool("llvm-dis");

const RUNTIME_LIB_SRCS = [
  "runtime/src/alloc.c",
  "runtime/src/gc.c",
  "runtime/src/panic.c",
  "runtime/src/print.c",
  "runtime/src/shadow.c",
  "runtime/src/variants.c",
  "runtime/src/str.c",
  "runtime/src/map.c",
  "runtime/src/closure.c",
  "runtime/src/io.c",
  "runtime/src/equal.c",
].map(abs);
const RUNTIME_INCLUDE = abs("runtime/include");
const entry = "tests/phase2/oracle/spawn-capture.mnd";

function emit(outPath: string): { exitCode: number; stderr: string } {
  const entryPath = abs("src/mn.mnd");
  const source = readFileSync(entryPath);
  const stderrChunks: Uint8Array[] = [];
  const host = createLiveHost({
    realFs: true,
    argv: ["emit", abs(entry), outPath],
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

function interpret(): { exitCode: number; stdout: string; stderr: string } {
  const entryPath = abs(entry);
  const source = readFileSync(entryPath);
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  const host = createLiveHost({
    realFs: true,
    argv: [],
    spawnEnabled: true,
    stdout: { write: (b: Uint8Array) => stdoutChunks.push(b) },
    stderr: { write: (b: Uint8Array) => stderrChunks.push(b) },
  });
  const dec = new TextDecoder();
  const r = run(source, { path: entryPath, host });
  const stdout = stdoutChunks.map((b) => dec.decode(b)).join("");
  const stderr = stderrChunks.map((b) => dec.decode(b)).join("");
  if (!r.ok) {
    throw new Error(`interpreter failed: ${r.kind === "diagnostics" ? JSON.stringify(r.diagnostics) : r.message}`);
  }
  if (r.exitCode !== undefined) return { exitCode: r.exitCode, stdout, stderr };
  if (r.value.tag !== "int") {
    throw new Error(`interpreter did not produce an Int main result: got ${r.value.tag}`);
  }
  return { exitCode: Number(BigInt.asUintN(8, r.value.value)), stdout, stderr };
}

describe.skipIf(clang === null || llvmDis === null)("spawn-capture oracle", () => {
  test("interpreter and native agree on captured stdout", async () => {
    const interp = interpret();
    expect(interp.stdout).toBe("hi\nab");
    expect(interp.exitCode).toBe(0);

    const dir = await mkdtempP(join(tmpdir(), "menard-proc-"));
    const bcPath = join(dir, "out.bc");
    const binPath = join(dir, "out");
    try {
      const emitted = emit(bcPath);
      expect(emitted.stderr).toBe("");
      expect(emitted.exitCode).toBe(0);

      const dis = spawnSync(llvmDis!, [bcPath, "-o", "-"], { encoding: "utf-8" });
      expect(dis.status).toBe(0);
      expect(dis.stdout).toMatch(/\bcall i64 @mn_spawn_capture\b/);

      const link = spawnSync(
        clang!,
        [bcPath, ...RUNTIME_LIB_SRCS, "-I", RUNTIME_INCLUDE, "-lm", "-o", binPath],
        { encoding: "utf-8" },
      );
      expect(link.status).toBe(0);

      const ran = spawnSync(binPath, [], { encoding: "utf-8" });
      expect(ran.stdout).toBe(interp.stdout);
      expect(ran.stderr).toBe(interp.stderr);
      expect(ran.status).toBe(interp.exitCode);
    } finally {
      await rm(bcPath).catch(() => {});
      await rm(binPath).catch(() => {});
    }
  });
});
