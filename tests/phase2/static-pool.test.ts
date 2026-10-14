/**
 * Static pool emission: string literals and nullary constructors are
 * align-8 objects, one per distinct value, in pool-summary order.
 * `None` is the runtime singleton, not a second copy.
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

const ROOT = join(import.meta.dir, "../..");

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

const llvmDis = whichTool("llvm-dis");

function emit(entryRelPath: string, outPath: string): { exitCode: number; stderr: string } {
  const entryPath = abs("src/mn.mnd");
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

describe("static pool objects", () => {
  test("literals are aligned, deduped, and sorted; None is the runtime singleton", async () => {
    if (llvmDis === null) return;
    const dir = await mkdtempP(join(tmpdir(), "menard-static-pool-"));
    const bc = join(dir, "static-pool.bc");
    try {
      const out = emit("tests/phase2/fixtures/static-pool.mnd", bc);
      expect(out.stderr).toBe("");
      expect(out.exitCode).toBe(0);
      const dis = spawnSync(llvmDis, [bc, "-o", "-"], { encoding: "utf8" });
      expect(dis.status).toBe(0);
      const ir = dis.stdout;
      expect(ir).toContain("align 8");
      const a = ir.indexOf('i64 1, [1 x i8] c"a"');
      const ab = ir.indexOf('i64 2, [2 x i8] c"ab"');
      const b = ir.indexOf('i64 1, [1 x i8] c"b"');
      expect(a).toBeGreaterThan(-1);
      expect(ab).toBeGreaterThan(a);
      expect(b).toBeGreaterThan(ab);
      expect(ir.split('i64 1, [1 x i8] c"a"').length).toBe(2);
      expect(ir.split('i64 2, [2 x i8] c"ab"').length).toBe(2);
      expect(ir).toContain("@mn_static_none = external constant i8, align 8");
      expect(ir).toContain("ptrtoint ptr @mn_static_none to i64");
      const nullaries = ir.match(/constant \{ ptr \} \{ ptr @\d+ \}, align 8/g);
      expect(nullaries?.length).toBe(1);
    } finally {
      await rm(bc).catch(() => {});
    }
  });
});
