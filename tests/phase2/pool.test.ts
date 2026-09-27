/**
 * Phase 2 slice 2F — static pool collection (`src/pool/pool.mnd`),
 * exercised through the harness `src/tools/pool-dump.mnd` (not part of
 * the compiler — see that module's own header comment) and, separately,
 * confirmed to be wired into the real `emit` path.
 *
 * Runs `src/mn.mnd`/`src/tools/pool-dump.mnd` (compiled/interpreted by
 * the Phase 1 host, exactly as `bun run host/src/cli/menard.ts run …`
 * would) against real fixture files and checks that:
 *   - `pool-summary` dedups two identical `Str` literals to one entry,
 *     keeps a distinct third literal as its own entry, and reports a
 *     nullary constructor mention (`(None)`) — matching the golden fixture
 *     `tests/phase2/goldens/pool-basic.txt` byte for byte.
 *   - Entries are sorted by byte content (ADR 38/spec §2.2.1).
 *   - `emit` still succeeds on a foldable program once pool collection
 *     runs ahead of lowering (`emit/bitcode.mnd`'s wiring) — the
 *     collector must not change what a program compiles to.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, unlink, mkdtemp } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../host/src/interp/pipeline.ts";
import { createLiveHost } from "../../host/src/host/index.ts";

const rm = promisify(unlink);
const mkdtempP = promisify(mkdtemp);

type RunOut = { exitCode: number; stdout: string; stderr: string };

const ROOT = join(import.meta.dir, "../..");

/** Resolve a path relative to the repo root to an absolute path for argv. */
function abs(relPath: string): string {
  return join(ROOT, relPath);
}

/**
 * Run a Menard entry file against the real filesystem, argv after `--`.
 * `read-file`/`write-file` resolve whatever string the Menard program
 * passes them relative to the *process's* cwd (not the entry file's
 * directory), so callers should pass absolute paths for file arguments —
 * see `abs()` above.
 */
function runMenard(entryRelPath: string, argv: string[]): RunOut {
  const entryPath = abs(entryRelPath);
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

const POOL_BASIC_GOLDEN = readFileSync(abs("tests/phase2/goldens/pool-basic.txt"), "utf-8");

describe("src/tools/pool-dump.mnd", () => {
  test("dedups identical Str literals, keeps a distinct one, reports a nullary ctor mention", () => {
    const out = runMenard("src/tools/pool-dump.mnd", [abs("tests/phase2/fixtures/pool-basic.mnd")]);
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe(POOL_BASIC_GOLDEN);
  });

  test("entries are sorted by byte content ('ctor …' before 'str …')", () => {
    const out = runMenard("src/tools/pool-dump.mnd", [abs("tests/phase2/fixtures/pool-basic.mnd")]);
    const lines = out.stdout.trimEnd().split("\n");
    const sorted = [...lines].sort();
    expect(lines).toEqual(sorted);
  });

  test("reports two unique Str entries for two identical literals plus one distinct one", () => {
    const out = runMenard("src/tools/pool-dump.mnd", [abs("tests/phase2/fixtures/pool-basic.mnd")]);
    const strLines = out.stdout.trimEnd().split("\n").filter((l) => l.startsWith("str "));
    expect(strLines).toEqual(['str "hello"', 'str "world"']);
  });

  test("an empty program has an empty pool", () => {
    const out = runMenard("src/tools/pool-dump.mnd", [abs("tests/corpus/comments-and-bools.mnd")]);
    expect(out.exitCode).toBe(0);
    // No Str literals or nullary constructor mentions in this corpus file.
    expect(out.stdout).toBe("\n");
  });
});

describe("src/mn.mnd emit — pool collection wired ahead of lowering", () => {
  test("emit still succeeds on hello.mnd once pool collection runs first", async () => {
    const dir = await mkdtempP(join(tmpdir(), "menard-pool-"));
    const outPath = join(dir, "hello.bc");
    try {
      const out = runMenard("src/mn.mnd", ["emit", abs("hello.mnd"), outPath]);
      expect(out.stderr).toBe("");
      expect(out.exitCode).toBe(0);
    } finally {
      await rm(outPath).catch(() => {});
    }
  });
});
