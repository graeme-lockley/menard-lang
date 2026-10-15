/**
 * §2.11 rows O, I, T, A, B, and S, plus the empty word and dump isolation.
 * Native agreement for the corpus program is tests/corpus/oracle.test.ts.
 * Divide-by-zero agreement with the compiled runtime is
 * tests/phase2/oracle.test.ts on tests/phase2/oracle/div-zero.mnd.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { dumpValue, run } from "../../host/src/interp/index.ts";
import { createLiveHost } from "../../host/src/host/index.ts";
import type { Value } from "../../host/src/interp/value.ts";

const ROOT = join(import.meta.dir, "../..");

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

const llvmDis = whichTool("llvm-dis");

function emit(entry: string, outPath: string): { exitCode: number; stderr: string } {
  const entryPath = join(ROOT, "src/mn.mnd");
  const stderrChunks: Uint8Array[] = [];
  const host = createLiveHost({
    realFs: true,
    argv: ["emit", entry, outPath],
    stdout: { write: () => {} },
    stderr: { write: (b: Uint8Array) => stderrChunks.push(b) },
  });
  const r = run(readFileSync(entryPath), { path: entryPath, host });
  const stderr = stderrChunks.map((b) => new TextDecoder().decode(b)).join("");
  if (r.ok) return { exitCode: r.exitCode ?? 0, stderr };
  if (r.kind === "diagnostics") return { exitCode: 2, stderr: stderr + JSON.stringify(r.diagnostics) };
  return { exitCode: 2, stderr: stderr + "[panic] " + r.message };
}

function interpret(source: string, path?: string): { stdout: string; stderr: string; result: ReturnType<typeof run> } {
  const out: Uint8Array[] = [];
  const err: Uint8Array[] = [];
  const host = createLiveHost({
    realFs: true,
    argv: path ? [path] : [],
    stdout: { write: (b: Uint8Array) => out.push(b) },
    stderr: { write: (b: Uint8Array) => err.push(b) },
  });
  const dec = new TextDecoder();
  const result = path ? run(source, { path, host }) : run(source, { host });
  return {
    stdout: out.map((b) => dec.decode(b)).join(""),
    stderr: err.map((b) => dec.decode(b)).join(""),
    result,
  };
}

function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => {
      const i = line.indexOf(";");
      return i < 0 ? line : line.slice(0, i);
    })
    .join("\n");
}

function mndFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "build" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) mndFiles(p, out);
    else if (name.endsWith(".mnd")) out.push(p);
  }
}

function walkValues(v: Value, seen: Value[]): void {
  seen.push(v);
  switch (v.tag) {
    case "list":
      for (const e of v.elems) walkValues(e, seen);
      break;
    case "variant":
      for (const p of v.payloads) walkValues(p, seen);
      break;
    case "record":
      for (const f of v.fields) walkValues(f, seen);
      break;
    case "ref":
      walkValues(v.cell.value, seen);
      break;
    default:
      break;
  }
}

describe("§2.11 determinism", () => {
  test("O: map keys are sorted, not insertion order", () => {
    const ran = interpret(readFileSync(join(ROOT, "tests/corpus/determinism.mnd"), "utf8"), join(ROOT, "tests/corpus/determinism.mnd"));
    expect(ran.result.ok).toBe(true);
    expect(ran.stdout.split("\n")[0]).toBe("true");
  });

  test("I: an absolute path and an alias name are absent from bitcode", () => {
    if (llvmDis === null) return;
    const dir = mkdtempSync(join(tmpdir(), "menard-alias-"));
    const file = join(dir, "alias.mnd");
    const bc1 = join(dir, "a.bc");
    const bc2 = join(dir, "b.bc");
    const program = (alias: string) =>
      `type Color =\n  | Red\n\nalias ${alias} = Color\n\nlet paint() -> ${alias} =\n  Red()\n\nlet main() -> Int {\n  println(show(paint()))\n  0\n}\n`;
    try {
      writeFileSync(file, program("Hue"));
      const first = emit(file, bc1);
      expect(first.stderr).toBe("");
      expect(first.exitCode).toBe(0);
      writeFileSync(file, program("Tint"));
      const second = emit(file, bc2);
      expect(second.stderr).toBe("");
      expect(second.exitCode).toBe(0);
      const a = readFileSync(bc1);
      const b = readFileSync(bc2);
      expect(Buffer.compare(a, b)).toBe(0);
      const dis = spawnSync(llvmDis, [bc1, "-o", "-"], { encoding: "utf8" });
      expect(dis.status).toBe(0);
      expect(dis.stdout).not.toContain("Hue");
      expect(dis.stdout).not.toContain("Tint");
      expect(dis.stdout).not.toContain("Color");
      expect(dis.stdout).toMatch(/constant \{ ptr \} \{ ptr @\d+ \}, align 8/);
      const rel = relative(process.cwd(), join(ROOT, "tests/corpus/determinism.mnd"));
      const relBc = join(dir, "rel.bc");
      const relEmit = emit(rel, relBc);
      expect(relEmit.stderr).toBe("");
      expect(relEmit.exitCode).toBe(0);
      const relDis = spawnSync(llvmDis, [relBc, "-o", "-"], { encoding: "utf8" });
      expect(relDis.status).toBe(0);
      expect(relDis.stdout).toContain(rel);
      expect(relDis.stdout).not.toContain(join(ROOT, rel));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("T: one float spelling per bit pattern, and -0.0 stays distinct", () => {
    const text = readFileSync(join(ROOT, "tests/corpus/determinism.mnd"), "utf8");
    const ran = interpret(text, join(ROOT, "tests/corpus/determinism.mnd"));
    const lines = ran.stdout.split("\n");
    expect(lines[2]).toBe("1.0");
    expect(lines[3]).toBe("1.0");
    expect(lines[4]).toBe("true");
    expect(lines[5]).toBe("-0.0");
    expect(lines[6]).toBe("-0.0");
    expect(lines[7]).toBe("true");
    expect(lines[8]).toBe("0.0");
    expect(lines[9]).toBe("false");
  });

  test("A: overflow wraps and division by zero panics", () => {
    const ran = interpret(readFileSync(join(ROOT, "tests/corpus/determinism.mnd"), "utf8"), join(ROOT, "tests/corpus/determinism.mnd"));
    expect(ran.stdout.split("\n")[1]).toBe("true");
    const div = run("let main() -> Int =\n  1 / 0\n");
    expect(div.ok).toBe(false);
    if (!div.ok) expect(div.kind === "panic" ? div.message : "").toBe("division by zero");
  });

  test("B: extern is confined to sys, io, fs, and proc", () => {
    const seam = new Set(["stdlib/sys.mnd", "stdlib/io.mnd", "stdlib/fs.mnd", "stdlib/proc.mnd"].map((p) => join(ROOT, p)));
    const files: string[] = [];
    mndFiles(ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      if (seam.has(file)) continue;
      const text = codeOf(file);
      if (/\(extern(\s|\))/.test(text) || /\(pub\s+extern(\s|\))/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("S: the hash mix is a source constant", () => {
    const src = readFileSync(join(ROOT, "src/modules/graph.mnd"), "utf8");
    const mix = src.slice(src.indexOf("let hash-mix"), src.indexOf("let hash-bytes"));
    expect(mix).toContain("131");
    expect(mix).toContain("2147483647");
    expect(mix).not.toContain("now-ms");
    expect(mix).not.toContain("getenv");
  });

  test("no evaluated value is the empty word, and dump does not spell it", () => {
    const source = `let main() -> Int {
  dump(0)
  dump(())
  dump(true)
  dump("hi")
  dump(None())
  0
}
`;
    const ran = interpret(source);
    expect(ran.result.ok).toBe(true);
    if (!ran.result.ok) return;
    const seen: Value[] = [];
    walkValues(ran.result.value, seen);
    for (const v of seen) {
      expect(v).not.toBeNull();
      expect(v.tag).not.toBe("");
    }
    expect(ran.result.value).toEqual({ tag: "int", value: 0n });
    const dumped = [0, true, "hi", "None"].map((sample) => {
      if (sample === 0) return dumpValue({ tag: "int", value: 0n });
      if (sample === true) return dumpValue({ tag: "bool", value: true });
      if (sample === "hi") return dumpValue({ tag: "str", bytes: new TextEncoder().encode("hi") });
      return dumpValue({ tag: "variant", ctor: "None", payloads: [] });
    });
    for (const text of [ran.stderr, ...dumped]) {
      expect(text).not.toContain("null");
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("empty word");
    }
    expect(ran.stderr).toContain("(None)");
  });

  test("dump stays on stderr and out of stdout data", () => {
    if (llvmDis === null) return;
    const dir = mkdtempSync(join(tmpdir(), "menard-dump-"));
    const file = join(dir, "dump.mnd");
    const bc1 = join(dir, "a.bc");
    const bc2 = join(dir, "b.bc");
    const source = `let main() -> Int {
  dump("dump-secret")
  println("printed-line")
  0
}
`;
    try {
      writeFileSync(file, source);
      const ran = interpret(source, file);
      expect(ran.stdout).toBe("printed-line\n");
      expect(ran.stderr).toContain("dump-secret");
      expect(ran.stdout).not.toContain("dump-secret");
      const first = emit(file, bc1);
      const second = emit(file, bc2);
      expect(first.stderr).toBe("");
      expect(second.stderr).toBe("");
      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(Buffer.compare(readFileSync(bc1), readFileSync(bc2))).toBe(0);
      const dis = spawnSync(llvmDis, [bc1, "-o", "-"], { encoding: "utf8" });
      expect(dis.status).toBe(0);
      expect(dis.stdout).toContain('c"printed-line"');
      expect(dis.stdout).toContain("call void @mn_write_stdout");
      expect(dis.stdout).toContain("call i64 @mn_dump");
      const stdoutCall = dis.stdout.split("call void @mn_write_stdout")[1] ?? "";
      expect(stdoutCall.slice(0, 200)).not.toContain("dump-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
