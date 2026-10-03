/**
 * Phase 2 — the typer wired into `src/mn.mnd`'s `check` pipeline.
 *
 * Accept/reject and rest-packing are `src/type/check.test.mnd`. This file
 * checks `--dump-after=type`: it prints the post-typecheck forms on
 * success, and it does not run when typechecking already failed. A
 * desugar error still stops the pipeline before the typer.
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

describe("src/mn.mnd check — typer wired after desugar", () => {
  test("--dump-after=type dumps the post-typecheck forms on success", () => {
    const out = runMenard("src/mn.mnd", [
      "check",
      abs("tests/phase2/fixtures/type-ok.mnd"),
      "--dump-after=type",
    ]);
    expect(out.exitCode).toBe(0);
    expect(out.stderr).toContain('"defn"');
    expect(out.stderr).toContain('"add-one"');
  });

  test("--dump-after=type never fires when typechecking fails", () => {
    const out = runMenard("src/mn.mnd", [
      "check",
      abs("tests/negative/bad-type-unbound.mnd"),
      "--dump-after=type",
    ]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("[E_TYPE_UNBOUND]");
  });

  test("still fails a desugar error before the typer ever runs", () => {
    const out = runMenard("src/mn.mnd", [
      "check",
      abs("tests/negative/bad-desugar-when.mnd"),
    ]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("[E_PARSE]");
    expect(out.stderr).not.toContain("E_TYPE_");
  });
});
