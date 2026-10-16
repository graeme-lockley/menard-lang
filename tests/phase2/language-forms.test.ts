/**
 * The five surface changes, on the host typer and through `src/mn.mnd check`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { diagnose } from "../../host/src/interp/index.ts";
import { run } from "../../host/src/interp/pipeline.ts";
import { createLiveHost } from "../../host/src/host/index.ts";

const ROOT = join(import.meta.dir, "../..");

function abs(relPath: string): string {
  return join(ROOT, relPath);
}

function src(relPath: string): string {
  return readFileSync(abs(relPath), "utf8");
}

function codes(relPath: string): string[] {
  return diagnose(src(relPath)).map((d) => d.code);
}

function runMenard(argv: string[]): { exitCode: number; stderr: string } {
  const entryPath = abs("src/mn.mnd");
  const source = readFileSync(entryPath);
  const stderrChunks: Uint8Array[] = [];
  const host = createLiveHost({
    realFs: true,
    argv,
    stdout: { write: () => {} },
    stderr: { write: (b: Uint8Array) => stderrChunks.push(b) },
  });
  const r = run(source, { path: entryPath, host });
  const stderr = stderrChunks.map((b) => new TextDecoder().decode(b)).join("");
  if (r.ok) return { exitCode: r.exitCode ?? 0, stderr };
  if (r.kind === "diagnostics") {
    const msg = r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n");
    return { exitCode: 2, stderr: stderr + "\n" + msg };
  }
  return { exitCode: 2, stderr: stderr + "\n" + r.message };
}

describe("language forms — host", () => {
  test("accepts a recursive record, a named pattern, and a multi-value match", () => {
    expect(codes("tests/phase2/fixtures/language-forms.mnd")).toEqual([]);
  });

  test("rejects a second definition of a type", () => {
    expect(codes("tests/negative/bad-type-duplicate.mnd")).toContain("E_TYPE_DUPLICATE");
  });

  test("rejects a public signature that names a private nominal", () => {
    expect(codes("tests/negative/bad-pub-private.mnd")).toContain("E_PUB_PRIVATE_TYPE");
  });

  test("rejects an unknown record field", () => {
    expect(codes("tests/negative/bad-named-field.mnd")).toContain("E_TYPE_UNBOUND");
  });

  test("rejects a named pattern on a variant", () => {
    expect(codes("tests/negative/bad-named-variant.mnd")).toContain("E_TYPE_MISMATCH");
  });

  test("rejects a pattern whose length does not match the scrutinees", () => {
    expect(codes("tests/negative/bad-match-arity.mnd")).toContain("E_PARSE");
  });

  test("rejects a non-exhaustive product", () => {
    expect(codes("tests/negative/bad-match-product.mnd")).toContain("E_TYPE_EXHAUSTIVE");
  });
});

describe("language forms — menard check", () => {
  test("accepts the fixture", () => {
    const out = runMenard(["check", abs("tests/phase2/fixtures/language-forms.mnd"), "--dump-after=type"]);
    expect(out.exitCode).toBe(0);
  });

  test("reports the new errors", () => {
    const cases: Array<[string, string]> = [
      ["tests/negative/bad-type-duplicate.mnd", "E_TYPE_DUPLICATE"],
      ["tests/negative/bad-pub-private.mnd", "E_PUB_PRIVATE_TYPE"],
      ["tests/negative/bad-named-field.mnd", "E_TYPE_UNBOUND"],
      ["tests/negative/bad-named-variant.mnd", "E_TYPE_MISMATCH"],
      ["tests/negative/bad-match-arity.mnd", "E_PARSE"],
      ["tests/negative/bad-match-product.mnd", "E_TYPE_EXHAUSTIVE"],
    ];
    for (const [file, code] of cases) {
      const out = runMenard(["check", abs(file), "--dump-after=type"]);
      expect(out.exitCode).not.toBe(0);
      expect(out.stderr).toContain(code);
    }
  });
});
