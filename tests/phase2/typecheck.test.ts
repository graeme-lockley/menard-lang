/**
 * Phase 2 — the Menard-in-Menard typer (`src/type/check.mnd`), wired into
 * `src/mn.mnd`'s `check`/`emit` pipeline as the stage after desugaring.
 *
 * Runs `src/mn.mnd` (compiled/interpreted by the Phase 1 host, exactly as
 * `bun run host/src/cli/menard.ts run …` would) against real fixture files
 * and checks that:
 *   - `check` accepts a well-typed program (simple `defn` + Int arithmetic).
 *   - `check` rejects an unbound variable with `E_TYPE_UNBOUND`, mirroring
 *     the diagnostic code `host/src/type/check.ts` reports (see
 *     `tests/unit/type/typecheck.test.ts`).
 *   - `check` rejects a non-Bool `if` test with `E_TYPE_MISMATCH`, again
 *     mirroring the host's typer.
 *   - `--dump-after=type` prints the post-typecheck forms to stderr, and
 *     only runs when the program is well-typed (it never fires when an
 *     earlier stage — or the typer itself — already failed).
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
  test("accepts a well-typed defn using Int arithmetic", () => {
    const out = runMenard("src/mn.mnd", ["check", abs("tests/phase2/fixtures/type-ok.mnd")]);
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
  });

  test("rejects an unbound variable with E_TYPE_UNBOUND", () => {
    const out = runMenard("src/mn.mnd", [
      "check",
      abs("tests/phase2/fixtures/bad-type-unbound.mnd"),
    ]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("[E_TYPE_UNBOUND]");
  });

  test("rejects a non-Bool if test with E_TYPE_MISMATCH", () => {
    const out = runMenard("src/mn.mnd", [
      "check",
      abs("tests/phase2/fixtures/bad-type-if-nonbool.mnd"),
    ]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("[E_TYPE_MISMATCH]");
  });

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
      abs("tests/phase2/fixtures/bad-type-unbound.mnd"),
      "--dump-after=type",
    ]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("[E_TYPE_UNBOUND]");
  });

  test("still fails a desugar error before the typer ever runs", () => {
    const out = runMenard("src/mn.mnd", [
      "check",
      abs("tests/phase2/fixtures/bad-desugar-when.mnd"),
    ]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("[E_DESUGAR_WHEN]");
    expect(out.stderr).not.toContain("E_TYPE_");
  });
});
