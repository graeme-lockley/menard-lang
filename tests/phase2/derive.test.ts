/**
 * Phase 2 slice 2F — derive planning wired into `--dump-after=derive`.
 *
 * What `describe-derives` reports is `src/derive/plan.test.mnd`. This
 * file checks the flag: the plan is printed beside the forms dump, and
 * it is not printed when typechecking already failed or when the flag
 * is absent.
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

describe("src/mn.mnd check — derive planning wired after rooting", () => {
  test("accepts a program using show(1) with no --dump-after flag", () => {
    const out = runMenard("src/mn.mnd", ["check", abs("tests/phase2/fixtures/derive-show-int.mnd")]);
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
  });

  test("--dump-after=derive reports Int as needing show for show(1)", () => {
    const out = runMenard("src/mn.mnd", [
      "check",
      abs("tests/phase2/fixtures/derive-show-int.mnd"),
      "--dump-after=derive",
    ]);
    expect(out.exitCode).toBe(0);
    // The raw forms dump (existing behaviour) is still there…
    expect(out.stderr).toContain('"defn"');
    // …alongside the new derive plan line.
    expect(out.stderr).toContain("Int: show");
  });

  test("--dump-after=derive never fires when typechecking fails", () => {
    const out = runMenard("src/mn.mnd", [
      "check",
      abs("tests/negative/bad-type-unbound.mnd"),
      "--dump-after=derive",
    ]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("[E_TYPE_UNBOUND]");
    expect(out.stderr).not.toContain(": show");
  });
});
