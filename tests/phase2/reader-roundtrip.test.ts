/**
 * Phase 2 (slice 2.0/2.1) — the Menard-in-Menard reader.
 *
 * Runs the Menard programs under `src/` (compiled/interpreted by the Phase 1
 * host, exactly as `bun run host/src/cli/menard.ts run …` would) against the
 * real filesystem, and checks `src/mn.mnd`'s `check` and `emit` CLI modes.
 * The read → print → read property is `src/reader/read.test.mnd`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readFile as readFileCb, unlink, mkdtemp } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../host/src/interp/pipeline.ts";
import { createLiveHost } from "../../host/src/host/index.ts";

const readFile = promisify(readFileCb);
const rm = promisify(unlink);
const mkdtempP = promisify(mkdtemp);

const ROOT = join(import.meta.dir, "../..");

type RunOut = { exitCode: number; stdout: string; stderr: string };

/**
 * Run a Menard entry file against the real filesystem, argv after `--`.
 * `read-file`/`write-file` resolve whatever string the Menard program
 * passes them relative to the *process's* cwd (not the entry file's
 * directory), so callers should pass absolute paths for file arguments —
 * see `abs()` below.
 */
function runMenard(entryRelPath: string, argv: string[]): RunOut {
  const entryPath = join(ROOT, entryRelPath);
  const source = readFileSync(entryPath);
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  const host = createLiveHost({
    realFs: true,
    argv,
    stdout: { write: (b: Uint8Array) => stdoutChunks.push(b) },
    stderr: { write: (b: Uint8Array) => stderrChunks.push(b) },
  });
  const dec = new TextDecoder();
  const r = run(source, { path: entryPath, host });
  const stdout = stdoutChunks.map((b) => dec.decode(b)).join("");
  const stderr = stderrChunks.map((b) => dec.decode(b)).join("");
  if (r.ok) {
    return { exitCode: r.exitCode ?? 0, stdout, stderr };
  }
  if (r.kind === "diagnostics") {
    const msg = r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n");
    return { exitCode: 2, stdout, stderr: stderr + "\n[diagnostics]\n" + msg };
  }
  return { exitCode: 2, stdout, stderr: stderr + "\n[panic] " + r.message };
}

/** Resolve a path relative to the repo root to an absolute path for argv. */
function abs(relPath: string): string {
  return join(ROOT, relPath);
}

const CORPUS_FILES = [
  "hello.mnd",
  "tests/corpus/comments-and-bools.mnd",
  "tests/corpus/spec-examples.mnd",
  "tests/corpus/invalid-utf8.mnd",
];

describe("src/mn.mnd check", () => {
  for (const rel of CORPUS_FILES) {
    test(`exits 0 on ${rel}`, () => {
      const out = runMenard("src/mn.mnd", ["check", abs(rel)]);
      expect(out.stderr).toBe("");
      expect(out.exitCode).toBe(0);
    });
  }

  test("exits 1 with a diagnostic on a parse error", () => {
    const out = runMenard("src/mn.mnd", ["check", abs("tests/negative/bad-parse.mnd")]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("error[");
  });

  test("exits 1 with a diagnostic on a casing error", () => {
    const out = runMenard("src/mn.mnd", ["check", abs("tests/negative/bad-casing.mnd")]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("must begin with a lowercase letter");
  });

  test("exits 2 on a missing file", () => {
    const out = runMenard("src/mn.mnd", ["check", abs("tests/corpus/does-not-exist.mnd")]);
    expect(out.exitCode).toBe(2);
  });

  test("exits 2 with usage on missing arguments", () => {
    const out = runMenard("src/mn.mnd", []);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toContain("usage:");
  });

  test("--dump-after=reader dumps forms to stderr and still checks", () => {
    const out = runMenard("src/mn.mnd", ["check", abs("hello.mnd"), "--dump-after=reader"]);
    expect(out.exitCode).toBe(0);
    expect(out.stderr).toContain("SymNode");
    expect(out.stderr).toContain("println");
  });
});

// `src/emit/bitcode.mnd`'s `emit-program-bc` calls the real bit-level
// encoder in `src/emit/bc-writer.mnd` (slice 2A) through `src/emit/
// lower.mnd`'s real instruction selector (this slice): `hello.mnd`'s
// `let main() -> Int = 0` now lowers to a real `lshr`/`trunc`/`ret`
// sequence (untagging the tagged-`Int` literal `0`), not a single
// folded `ret i32 0` — so there is no more one-and-only byte-exact
// golden module every input necessarily produces (see this module's own
// former header comment, and `src/emit/lower.mnd`'s, for the constant-
// folding story this replaced). What's checked instead is exactly what
// `tests/phase2/bc-writer.test.ts` already checks for the same file:
// **raw** (unwrapped) bitcode — its first four bytes are the bitstream
// magic ('B' 'C' 0xC0 0xDE) directly, not the Darwin wrapper magic
// (0xDE 0xC0 0x17 0x0B) `runtime/fixtures/ret0.bc` starts with (see that
// fixture's own header comment, and `runtime/README.md`) — ADR 40
// forbids the compiler from emitting anything but bitcode, and ties the
// writer to no toolchain wrapper.
const BITSTREAM_MAGIC = Buffer.from([0x42, 0x43, 0xc0, 0xde]); // 'B' 'C' 0xC0 0xDE
const WRAPPER_MAGIC = Buffer.from([0xde, 0xc0, 0x17, 0x0b]); // 0x0B17C0DE, little-endian

describe("src/mn.mnd emit", () => {
  test("writes a raw bitcode module to an explicit output path", async () => {
    const dir = await mkdtempP(join(tmpdir(), "menard-phase2-"));
    const outPath = join(dir, "hello.bc");
    try {
      const out = runMenard("src/mn.mnd", ["emit", abs("hello.mnd"), outPath]);
      expect(out.stderr).toBe("");
      expect(out.exitCode).toBe(0);
      const bytes = await readFile(outPath);
      expect(bytes.subarray(0, 4).equals(BITSTREAM_MAGIC)).toBe(true);
      expect(bytes.subarray(0, 4).equals(WRAPPER_MAGIC)).toBe(false);
    } finally {
      await rm(outPath).catch(() => {});
    }
  });

  test("defaults the output path to <file>.bc when none is given", async () => {
    const dir = await mkdtempP(join(tmpdir(), "menard-phase2-"));
    const inPath = join(dir, "hello.mnd");
    const defaultOut = join(dir, "hello.bc");
    const { writeFile: writeFileCb } = await import("node:fs");
    const writeFile = promisify(writeFileCb);
    await writeFile(inPath, readFileSync(abs("hello.mnd")));
    await writeFile(join(dir, "fred.mnd"), readFileSync(abs("fred.mnd")));
    const out = runMenard("src/mn.mnd", ["emit", inPath]);
    expect(out.exitCode).toBe(0);
    const bytes = await readFile(defaultOut);
    expect(bytes.subarray(0, 4).equals(BITSTREAM_MAGIC)).toBe(true);
    expect(bytes.subarray(0, 4).equals(WRAPPER_MAGIC)).toBe(false);
  });
});
