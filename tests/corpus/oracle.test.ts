/**
 * Hermetic programs under tests/corpus/ and examples/: the interpreter,
 * bitcode from stage0, and bitcode from the stage1 driver must agree.
 * Stage0 is `src/mn.mnd` on the host. Stage1 is that bitcode linked with
 * the runtime. Programs that do not define `main`, and programs that
 * call `spawn` / `spawn-capture`, are outside this set.
 *
 * Stage0 is invoked through the CLI so the clang triple probe runs, the
 * same way `make check-fixed-point` emits. The programs themselves do
 * not start a child.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function whichTool(name: string): string | null {
  const onPath = Bun.which(name);
  if (onPath !== null) return onPath;
  for (const prefix of ["/opt/homebrew/opt/llvm/bin", "/usr/local/opt/llvm/bin"]) {
    const candidate = join(prefix, name);
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      /* absent */
    }
  }
  return null;
}

const clang = whichTool("clang");

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
].map((rel) => join(ROOT, rel));
const RUNTIME_INCLUDE = join(ROOT, "runtime/include");

function codeOf(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .split("\n")
    .map((line) => {
      const i = line.indexOf(";");
      return i < 0 ? line : line.slice(0, i);
    })
    .join("\n");
}

function hermeticPrograms(): string[] {
  const out: string[] = [];
  for (const dir of ["tests/corpus", "examples"]) {
    for (const name of readdirSync(join(ROOT, dir))) {
      if (!name.endsWith(".mnd")) continue;
      const rel = `${dir}/${name}`;
      const text = codeOf(rel);
      if (!/\(defn main -> (Int|Unit)\b/.test(text)) continue;
      if (/\(spawn(-capture)?(\s|\))/.test(text)) continue;
      out.push(rel);
    }
  }
  return out.sort();
}

function cli(args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["run", "host/src/cli/menard.ts", ...args], {
    cwd: ROOT,
    encoding: "utf-8",
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe.skipIf(clang === null)("hermetic corpus oracle", () => {
  test(
    "interpreter, stage0 bitcode, and stage1 bitcode agree",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "menard-corpus-"));
      const stageBc = join(dir, "stage.bc");
      const stage1 = join(dir, "stage1");
      try {
        const built = cli(["run", "src/mn.mnd", "--", "emit", "src/mn.mnd", stageBc]);
        expect(built.stderr).toBe("");
        expect(built.status).toBe(0);
        const linkStage = spawnSync(
          clang!,
          [stageBc, ...RUNTIME_LIB_SRCS, "-I", RUNTIME_INCLUDE, "-lm", "-o", stage1],
          { cwd: ROOT, encoding: "utf-8" },
        );
        expect(linkStage.status).toBe(0);

        const failures: string[] = [];
        for (const rel of hermeticPrograms()) {
          const bc0 = join(dir, "bc0.bc");
          const bc1 = join(dir, "bc1.bc");
          const bin = join(dir, "prog");
          const stage0 = cli(["run", "src/mn.mnd", "--", "emit", rel, bc0]);
          if (stage0.status !== 0 || stage0.stderr !== "") {
            failures.push(`${rel}: stage0 emit failed\n${stage0.stderr}`);
            continue;
          }
          const stage1Emit = spawnSync(stage1, ["emit", rel, bc1], {
            cwd: ROOT,
            encoding: "utf-8",
          });
          if ((stage1Emit.status ?? 1) !== 0) {
            failures.push(`${rel}: stage1 emit failed\n${stage1Emit.stderr}`);
            continue;
          }
          const a = readFileSync(bc0);
          const b = readFileSync(bc1);
          if (Buffer.compare(a, b) !== 0) {
            failures.push(`${rel}: stage0 and stage1 bitcode differ`);
            continue;
          }
          const link = spawnSync(
            clang!,
            [bc0, ...RUNTIME_LIB_SRCS, "-I", RUNTIME_INCLUDE, "-lm", "-o", bin],
            { cwd: ROOT, encoding: "utf-8" },
          );
          if ((link.status ?? 1) !== 0) {
            failures.push(`${rel}: link failed\n${link.stderr}`);
            continue;
          }
          const interp = cli(["run", rel]);
          const ran = spawnSync(bin, [], { cwd: ROOT, encoding: "utf-8" });
          const nativeOut = ran.stdout ?? "";
          const nativeErr = ran.stderr ?? "";
          const nativeStatus = ran.status ?? 1;
          if (nativeOut !== interp.stdout || nativeStatus !== interp.status) {
            failures.push(
              `${rel}: stdout/exit disagree\ninterp ${interp.status} ${JSON.stringify(interp.stdout)}\nnative ${nativeStatus} ${JSON.stringify(nativeOut)}\ninterp stderr ${JSON.stringify(interp.stderr)}\nnative stderr ${JSON.stringify(nativeErr)}`,
            );
          }
        }
        expect(failures).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    300000,
  );
});
