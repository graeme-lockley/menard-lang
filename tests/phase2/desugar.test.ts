/**
 * Phase 2 — desugar wired into `src/mn.mnd`'s `check` pipeline.
 *
 * Expansion and `E_DESUGAR_*` codes are `src/desugar/desugar.test.mnd`.
 * This file checks the CLI: `check` accepts sugar, `--dump-after` prints
 * the pre- and post-desugar forms, and a parse or casing error still
 * stops the pipeline before desugar.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../host/src/interp/pipeline.ts";
import { createLiveHost } from "../../host/src/host/index.ts";

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

const DESUGAR_HEADS = ["and", "or", "cond", "when", "while"];

describe("src/mn.mnd check — desugar wired after casing", () => {
  test("accepts and/or/cond/when/while sugar", () => {
    const out = runMenard("src/mn.mnd", ["check", abs("tests/phase2/fixtures/desugar-ok.mnd")]);
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
  });

  test("--dump-after=reader dumps the original, un-expanded forms", () => {
    const out = runMenard("src/mn.mnd", [
      "check",
      abs("tests/phase2/fixtures/desugar-ok.mnd"),
      "--dump-after=reader",
    ]);
    expect(out.exitCode).toBe(0);
    for (const head of DESUGAR_HEADS) {
      expect(out.stderr).toContain(`"${head}"`);
    }
  });

  test("--dump-after=desugar dumps forms with sugar heads fully expanded", () => {
    const out = runMenard("src/mn.mnd", [
      "check",
      abs("tests/phase2/fixtures/desugar-ok.mnd"),
      "--dump-after=desugar",
    ]);
    expect(out.exitCode).toBe(0);
    expect(out.stderr).toContain('"if"');
    expect(out.stderr).toContain('"loop"');
    for (const head of DESUGAR_HEADS) {
      expect(out.stderr).not.toContain(`"${head}"`);
    }
  });

  test("bracket lists still typecheck", () => {
    const file = abs("tests/phase2/fixtures/list-sugar.mnd");
    const before = runMenard("src/mn.mnd", ["check", file, "--dump-after=reader"]);
    expect(before.exitCode).toBe(0);
    expect(before.stderr).toContain("BracketNode");
    const checked = runMenard("src/mn.mnd", ["check", file]);
    expect(checked.exitCode).toBe(0);
    expect(checked.stderr).toBe("");
  });

  test("still fails a parse error before desugar ever runs", () => {
    const out = runMenard("src/mn.mnd", ["check", abs("tests/negative/bad-parse.mnd")]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("error[");
  });

  test("still fails a casing error before desugar ever runs", () => {
    const out = runMenard("src/mn.mnd", ["check", abs("tests/negative/bad-casing.mnd")]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("must begin with a lowercase letter");
  });

});
