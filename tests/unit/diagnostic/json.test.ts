import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { diagnose, run } from "../../../host/src/interp/index.ts";
import {
  DIAGNOSTICS_VERSION,
  formatDiagnosticsJson,
  formatPanicJson,
  diagnosticsToJson,
  panicToJson,
  diagnosticToJson,
  CATALOGUE_HELPS,
} from "../../../host/src/diagnostic/index.ts";

const ROOT = join(import.meta.dir, "../../..");
const CLI = join(ROOT, "host/src/cli/menard.ts");
const MN = join(ROOT, "mn");
const hasMn = existsSync(MN);

function parseStdoutJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  expect(trimmed.length).toBeGreaterThan(0);
  // Reject interleaved human text: the whole stdout must be one JSON value.
  expect(() => JSON.parse(trimmed)).not.toThrow();
  return JSON.parse(trimmed);
}

function helpOf(code: string, src: string): string | undefined {
  return diagnose(src).find((d) => d.code === code)?.help;
}

describe("diagnostics JSON schema", () => {
  test("every field on a typed diagnostic with help", () => {
    const src = "None()";
    const diags = diagnose(src);
    const d = diags.find((x) => x.code === "E_TYPE_NULLARY_CALL");
    expect(d).toBeDefined();
    expect(d!.help).toContain("None is a value");
    const doc = diagnosticsToJson(diags, src, "t.mnd");
    expect(doc.version).toBe(DIAGNOSTICS_VERSION);
    const j = doc.diagnostics.find((x) => x.code === "E_TYPE_NULLARY_CALL")!;
    expect(j).toMatchObject({
      code: "E_TYPE_NULLARY_CALL",
      severity: "error",
      message: expect.stringContaining("None"),
      help: expect.stringContaining("remove the parentheses"),
      path: "t.mnd",
    });
    expect(j.span).toEqual({
      start: expect.any(Number),
      end: expect.any(Number),
      line: expect.any(Number),
      column: expect.any(Number),
    });
    expect(j.span.line).toBe(1);
    expect(j.span.column).toBe(1);
    const text = formatDiagnosticsJson(diags, src, "t.mnd");
    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text.trim()).diagnostics[0].help).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(JSON.parse(text.trim()).diagnostics[0], "help")).toBe(
      true,
    );
  });

  test("help omitted when absent (not null)", () => {
    // Constructed without going through diagnostic(), so help stays unset.
    const j = diagnosticToJson(
      {
        severity: "error",
        category: "syntax",
        code: "E_PARSE_UNCLOSED",
        message: "unclosed {",
        span: { start: 0, end: 1 },
      },
      "{",
      "a.mnd",
    );
    expect(j.code).toBe("E_PARSE_UNCLOSED");
    expect(j).not.toHaveProperty("help");
    expect(JSON.stringify(j)).not.toContain('"help"');
  });

  test("live parse unclosed carries catalogue help in JSON", () => {
    const src = "{";
    const diags = diagnose(src);
    const j = diagnosticsToJson(diags, src, "a.mnd").diagnostics[0]!;
    expect(j.code).toBe("E_PARSE_UNCLOSED");
    expect(j.help).toBe(CATALOGUE_HELPS.E_PARSE_UNCLOSED);
  });

  test("every actionable catalogue help appears in JSON help field", () => {
    for (const [code, help] of Object.entries(CATALOGUE_HELPS)) {
      const j = diagnosticToJson(
        {
          severity: "error",
          category: "type",
          code,
          message: `sample for ${code}`,
          span: { start: 0, end: 1 },
          help,
        },
        "x",
        "t.mnd",
      );
      expect(j.help).toBe(help);
    }
  });

  test("glued == and n+1 carry help in JSON", () => {
    const glued = diagnose("a==b");
    expect(glued[0]!.code).toBe("E_PARSE");
    expect(glued[0]!.help).toBe("did you mean a == b?");
    const gluedJson = diagnosticsToJson(glued, "a==b", "g.mnd").diagnostics[0]!;
    expect(gluedJson.help).toBe("did you mean a == b?");

    const unbound = diagnose("let x = n+1\n");
    const u = unbound.find((d) => d.code === "E_TYPE_UNBOUND")!;
    expect(u.help).toContain("`n + 1`");
    const uJson = diagnosticsToJson(unbound, "let x = n+1\n", "u.mnd").diagnostics.find(
      (d) => d.code === "E_TYPE_UNBOUND",
    )!;
    expect(uJson.help).toContain("`n + 1`");
  });

  test("multi-error file yields one versioned object", () => {
    // Two independent top-level type errors in one source.
    const src = "true + 1\nNone()\n";
    const diags = diagnose(src);
    expect(diags.length).toBeGreaterThanOrEqual(2);
    const doc = diagnosticsToJson(diags, src, "multi.mnd");
    expect(doc.version).toBe(1);
    expect(doc.diagnostics.length).toBe(diags.length);
    for (const j of doc.diagnostics) {
      expect(j.span.line).toBeGreaterThanOrEqual(1);
      expect(j.span.column).toBeGreaterThanOrEqual(1);
    }
  });

  test("parse error has structured span", () => {
    const src = "{";
    const diags = diagnose(src);
    expect(diags[0]!.code).toBe("E_PARSE_UNCLOSED");
    const j = diagnosticsToJson(diags, src, "a.mnd").diagnostics[0]!;
    expect(j.span.start).toEqual(expect.any(Number));
    expect(j.span.end).toEqual(expect.any(Number));
    expect(j.span.line).toBe(1);
    expect(j.span.column).toEqual(expect.any(Number));
    expect(j.span.column).toBeGreaterThanOrEqual(1);
  });

  test("panic JSON on stderr shape; no JS stack for user panic", () => {
    const src = 'panic("boom")';
    const result = run(src, { path: "p.mnd" });
    expect(result.ok).toBe(false);
    if (result.ok || result.kind !== "panic") throw new Error("expected panic");
    const doc = panicToJson(
      result.message,
      result.sitePath ?? "p.mnd",
      result.span,
      result.frames ?? [],
      src,
    );
    expect(doc.kind).toBe("panic");
    expect(doc.message).toContain("boom");
    expect(doc.path).toBeTruthy();
    expect(doc.span).toMatchObject({
      start: expect.any(Number),
      end: expect.any(Number),
      line: expect.any(Number),
      column: expect.any(Number),
    });
    expect(Array.isArray(doc.frames)).toBe(true);
    const text = formatPanicJson(
      result.message,
      result.sitePath ?? "p.mnd",
      result.span,
      result.frames ?? [],
      src,
    );
    expect(text).not.toContain("PanicError");
    expect(text).not.toContain("    at ");
    expect(text).not.toMatch(/node_modules/);
  });

  test("user type errors have no stack trace in JSON", () => {
    const src = "None()";
    const text = formatDiagnosticsJson(diagnose(src), src, "t.mnd");
    expect(text).not.toContain("Error:");
    expect(text).not.toContain("    at ");
    expect(text).not.toContain("stack");
  });

  test("mn check --json: one JSON object on stdout, no human text", () => {
    const file = join(ROOT, "tests/negative/bad-nullary-call.mnd");
    const r = spawnSync(process.execPath, [CLI, "check", "--json", file], {
      encoding: "utf-8",
      cwd: ROOT,
    });
    expect(r.status).toBe(1);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
    const doc = parseStdoutJson(r.stdout) as {
      version: number;
      diagnostics: Array<{ code: string; help?: string; span: { line: number; column: number } }>;
    };
    expect(doc.version).toBe(1);
    expect(doc.diagnostics.some((d) => d.code === "E_TYPE_NULLARY_CALL")).toBe(true);
    const nullary = doc.diagnostics.find((d) => d.code === "E_TYPE_NULLARY_CALL")!;
    expect(nullary.help).toBeDefined();
    expect(nullary.span.line).toBeGreaterThanOrEqual(1);
    expect(nullary.span.column).toBeGreaterThanOrEqual(1);
    // stderr may be empty or internal; stdout must be pure JSON (already parsed).
    expect(r.stdout.trim().startsWith("{")).toBe(true);
    expect(r.stdout).not.toContain("error[");
    expect(r.stdout).not.toContain("help:");
  });

  test("mn check --json success is empty diagnostics", () => {
    const file = join(ROOT, "tests/corpus/nullary.mnd");
    const r = spawnSync(process.execPath, [CLI, "check", "--json", file], {
      encoding: "utf-8",
      cwd: ROOT,
    });
    expect(r.status).toBe(0);
    const doc = parseStdoutJson(r.stdout) as { version: number; diagnostics: unknown[] };
    expect(doc).toEqual({ version: 1, diagnostics: [] });
  });

  test("mn run --json: compile errors on stdout; panic on stderr; stdout of program unchanged", () => {
    const bad = join(ROOT, "tests/negative/bad-nullary-call.mnd");
    const compile = spawnSync(process.execPath, [CLI, "run", "--json", bad], {
      encoding: "utf-8",
      cwd: ROOT,
    });
    expect(compile.status).toBe(1);
    const cdoc = parseStdoutJson(compile.stdout) as { diagnostics: unknown[] };
    expect(cdoc.diagnostics.length).toBeGreaterThan(0);

    const src = 'println("out-ok")\npanic("p")\n';
    const tmp = join(ROOT, "tests/unit/diagnostic/_panic_tmp.mnd");
    writeFileSync(tmp, src);
    try {
      const panic = spawnSync(process.execPath, [CLI, "run", "--json", tmp], {
        encoding: "utf-8",
        cwd: ROOT,
      });
      expect(panic.status).toBe(1);
      expect(panic.stdout).toContain("out-ok");
      expect(panic.stdout).not.toContain('"kind":"panic"');
      const pdoc = JSON.parse(panic.stderr.trim()) as { kind: string; message: string };
      expect(pdoc.kind).toBe("panic");
      expect(pdoc.message).toContain("p");
      expect(panic.stderr).not.toContain("PanicError");
      expect(panic.stderr).not.toMatch(/\n\s+at /);
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  });

  test("actionable help present for orderable, arity, and unbound constructor", () => {
    expect(helpOf("E_TYPE_ORDERABLE", "compare(fn (x) = x, fn (y) = y)")).toContain(
      "only Int, Float, Str, Char, Bool",
    );
    expect(
      helpOf(
        "E_TYPE_ARITY",
        "let f(x: Int, y: Int) -> Int = x + y\nlet main() -> Int = f(1)\n",
      ),
    ).toContain("expected and found argument counts must match");
    const unboundSrc = `type Color =
  | Red
  | Green(Int)

let main() -> Int =
  match (Red)
    | NoSuch(x) -> 0
    | _ -> 0
`;
    const u = diagnose(unboundSrc).find(
      (d) => d.code === "E_TYPE_UNBOUND" && d.message === "unknown constructor",
    );
    expect(u).toBeDefined();
    expect(u!.help).toContain("qualify the constructor");
    const orderJson = diagnosticsToJson(
      diagnose("compare(fn (x) = x, fn (y) = y)"),
      "compare(fn (x) = x, fn (y) = y)",
      "o.mnd",
    ).diagnostics.find((d) => d.code === "E_TYPE_ORDERABLE")!;
    expect(orderJson.help).toContain("orderable");
  });

  describe.skipIf(!hasMn)("native ./mn --json", () => {
      test("operator-spacing help matches host diagnose JSON", () => {
        const file = join(ROOT, "tests/negative/bad-op-spacing-plus.mnd");
        const host = diagnose(readFileSync(file), { path: file });
        const h = host.find((d) => d.code === "E_TYPE_UNBOUND")!;
        expect(h.help).toContain("`n + 1`");

        const check = spawnSync(MN, ["check", "--json", file], {
          encoding: "utf-8",
          cwd: ROOT,
        });
        expect(check.status).toBe(1);
        const doc = parseStdoutJson(check.stdout) as {
          diagnostics: Array<{ code: string; help?: string; message: string }>;
        };
        const n = doc.diagnostics.find((d) => d.code === "E_TYPE_UNBOUND")!;
        expect(n.message).toBe(h.message);
        expect(n.help).toBe(h.help);

        const eqFile = join(ROOT, "tests/negative/bad-op-spacing-eq.mnd");
        const eqHost = diagnose(readFileSync(eqFile), { path: eqFile });
        expect(eqHost[0]!.help).toBe("did you mean a == b?");
        const eqCheck = spawnSync(MN, ["check", "--json", eqFile], {
          encoding: "utf-8",
          cwd: ROOT,
        });
        expect(eqCheck.status).toBe(1);
        const eqDoc = parseStdoutJson(eqCheck.stdout) as {
          diagnostics: Array<{ code: string; help?: string }>;
        };
        expect(eqDoc.diagnostics[0]!.help).toBe("did you mean a == b?");
      });

      test("./mn check --json and ./mn build --json share the schema", () => {
        const file = join(ROOT, "tests/negative/bad-nullary-call.mnd");
        const check = spawnSync(MN, ["check", "--json", file], {
          encoding: "utf-8",
          cwd: ROOT,
        });
        expect(check.status).toBe(1);
        const cdoc = parseStdoutJson(check.stdout) as {
          version: number;
          diagnostics: Array<{ code: string; help?: string; span: { line: number } }>;
        };
        expect(cdoc.version).toBe(1);
        expect(cdoc.diagnostics.some((d) => d.code === "E_TYPE_NULLARY_CALL")).toBe(true);
        expect(check.stdout).not.toContain("error[");

        const out = join(ROOT, "tests/unit/diagnostic/_build_tmp_bin");
        const build = spawnSync(MN, ["build", "--json", file, "-o", out], {
          encoding: "utf-8",
          cwd: ROOT,
        });
        expect(build.status).toBe(1);
        const bdoc = parseStdoutJson(build.stdout) as {
          version: number;
          diagnostics: Array<{ code: string; help?: string }>;
        };
        expect(bdoc.version).toBe(1);
        expect(bdoc.diagnostics.some((d) => d.code === "E_TYPE_NULLARY_CALL")).toBe(true);
        const nullary = bdoc.diagnostics.find((d) => d.code === "E_TYPE_NULLARY_CALL")!;
        expect(nullary.help).toContain("remove the parentheses");
        expect(build.stdout).not.toContain("error[");
        expect(build.stdout).not.toContain("Compiling");
      });

      test("./mn run --json: compile errors and native panic with real spans", () => {
        const bad = join(ROOT, "tests/negative/bad-nullary-call.mnd");
        const compile = spawnSync(MN, ["run", "--json", bad], {
          encoding: "utf-8",
          cwd: ROOT,
        });
        expect(compile.status).toBe(1);
        const cdoc = parseStdoutJson(compile.stdout) as { diagnostics: unknown[] };
        expect(cdoc.diagnostics.length).toBeGreaterThan(0);

        const tmp = join(ROOT, "tests/unit/diagnostic/_panic_native_tmp.mnd");
        writeFileSync(
          tmp,
          'let main() -> Int {\n  println("out-ok")\n  1 / 0\n}\n',
        );
        try {
          const panic = spawnSync(MN, ["run", "--json", "--clean", tmp], {
            encoding: "utf-8",
            cwd: ROOT,
          });
          expect(panic.status).toBe(1);
          expect(panic.stdout).toContain("out-ok");
          expect(panic.stdout).not.toContain('"kind":"panic"');
          const pdoc = JSON.parse(panic.stderr.trim()) as {
            kind: string;
            message: string;
            span: { start: number; end: number; line: number; column: number };
          };
          expect(pdoc.kind).toBe("panic");
          expect(pdoc.message).toContain("division by zero");
          expect(pdoc.span.line).toBe(3);
          expect(pdoc.span.column).toBe(1);
          // Byte offsets must come from the source line, not the 0/0 placeholder.
          expect(pdoc.span.start).toBeGreaterThan(0);
          expect(pdoc.span.end).toBeGreaterThan(pdoc.span.start);
        } finally {
          try {
            unlinkSync(tmp);
          } catch {
            /* ignore */
          }
        }
      });

      test("./mn check --json reports unbound constructor help", () => {
        const tmp = join(ROOT, "tests/unit/diagnostic/_unbound_ctor_tmp.mnd");
        writeFileSync(
          tmp,
          `type Color =
  | Red
  | Green(Int)

let main() -> Int =
  match (Red)
    | NoSuch(x) -> 0
    | _ -> 0
`,
        );
        try {
          const r = spawnSync(MN, ["check", "--json", tmp], {
            encoding: "utf-8",
            cwd: ROOT,
          });
          expect(r.status).toBe(1);
          const doc = parseStdoutJson(r.stdout) as {
            diagnostics: Array<{ code: string; message: string; help?: string }>;
          };
          const u = doc.diagnostics.find(
            (d) => d.code === "E_TYPE_UNBOUND" && d.message === "unknown constructor",
          );
          expect(u).toBeDefined();
          expect(u!.help).toContain("qualify the constructor");
        } finally {
          try {
            unlinkSync(tmp);
          } catch {
            /* ignore */
          }
        }
      });

      test("./mn test --json flushes compile diagnostics", () => {
        const dir = join(ROOT, "tests/unit/diagnostic/_test_json_tmp");
        const file = join(dir, "bad.test.mnd");
        try {
          spawnSync("mkdir", ["-p", dir], { cwd: ROOT });
          writeFileSync(file, "let main() -> Int =\n  {\n");
          const r = spawnSync(MN, ["test", "--json", dir], {
            encoding: "utf-8",
            cwd: ROOT,
          });
          expect(r.status).toBe(1);
          const doc = parseStdoutJson(r.stdout) as {
            version: number;
            diagnostics: Array<{ code: string }>;
          };
          expect(doc.version).toBe(1);
          expect(doc.diagnostics.some((d) => d.code === "E_PARSE_UNCLOSED")).toBe(true);
          expect(r.stdout).not.toContain("failed");
          expect(r.stdout).not.toContain("error[");
        } finally {
          try {
            unlinkSync(file);
            spawnSync("rmdir", [dir], { cwd: ROOT });
          } catch {
            /* ignore */
          }
        }
      });
  });

  test("diagnostics.md documents schema version 1", () => {
    const diagnosticsMd = readFileSync(join(ROOT, "docs/diagnostics.md"), "utf-8");
    expect(diagnosticsMd).toContain("version");
    expect(diagnosticsMd).toMatch(/"version"\s*:\s*1/);
    expect(diagnosticsMd).toContain("errors.md");
  });

  test("AGENTS.md and guide.md document JSON mode", () => {
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf-8");
    const guide = readFileSync(join(ROOT, "docs/guide.md"), "utf-8");
    expect(agents).toMatch(/check --json|diagnostics/);
    expect(guide).toMatch(/check --json|`--json`/);
  });
});
