import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CATALOGUE_HELPS,
  CATALOGUE_HELP_VARIANTS,
} from "../../../host/src/diagnostic/helps.ts";
import { diagnose } from "../../../host/src/interp/index.ts";
import { createHost, createVirtualFs } from "../../../host/src/host/index.ts";
import { desugarAll } from "../../../host/src/desugar/index.ts";
import { typecheckForms } from "../../../host/src/type/index.ts";

const ROOT = join(import.meta.dir, "../../..");

const CODE_RE = /"(E_[A-Z0-9_]+|W_[A-Z0-9_]+)"/g;
const HEADING_RE = /^### `(E_[A-Z0-9_]+|W_[A-Z0-9_]+)`$/gm;
const HELP_RE = /^- \*\*Help:\*\* ("(?:\\.|[^"\\])*")$/gm;
const PHASES = ["Parse", "Desugar", "Type", "Lower", "Runtime"] as const;

/** Help maps quote every catalogue code; they are not emit sites. */
const HELP_CATALOGUE_FILES = new Set([
  join(ROOT, "host/src/diagnostic/helps.ts"),
  join(ROOT, "src/diag/helps.mnd"),
]);

const RESERVED_SCOPE_CODES = [
  "E_TYPE_QUESTION_RETURN",
  "E_OPERATOR_SPACING",
  "E_TYPE_LOCAL_POLY",
  "E_UNSUPPORTED",
  "W_PATTERN_UNREACHABLE",
  "W_PATTERN_REDUNDANT",
] as const;

function isHelpCataloguePath(file: string): boolean {
  return HELP_CATALOGUE_FILES.has(file);
}

function collectFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "build" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      collectFiles(p, out);
      continue;
    }
    if (/\.test\./.test(name)) continue;
    if (name.endsWith(".ts") || name.endsWith(".mnd")) out.push(p);
  }
}

function listEmitScanFiles(): string[] {
  const files: string[] = [];
  collectFiles(join(ROOT, "host/src"), files);
  collectFiles(join(ROOT, "src"), files);
  return files.filter((f) => !isHelpCataloguePath(f));
}

function scanEmittedCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of listEmitScanFiles()) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(CODE_RE)) codes.add(m[1]!);
  }
  return codes;
}

function parseCatalogue(md: string): {
  codes: string[];
  helps: Map<string, string[]>;
  sections: Map<string, string>;
} {
  const codes: string[] = [];
  const helps = new Map<string, string[]>();
  const sections = new Map<string, string>();
  const parts = md.split(/^### `/m);
  for (const part of parts) {
    const m = part.match(/^(E_[A-Z0-9_]+|W_[A-Z0-9_]+)`/);
    if (!m) continue;
    const code = m[1]!;
    codes.push(code);
    const body = part.slice(m[0].length);
    sections.set(code, body);
    const hs: string[] = [];
    for (const hm of body.matchAll(HELP_RE)) hs.push(JSON.parse(hm[1]!) as string);
    helps.set(code, hs);
  }
  return { codes, helps, sections };
}

function sampleJson(body: string): {
  code: string;
  message: string;
  help: string;
  path: string;
  span: { start: number; end: number; line: number; column: number };
} {
  const m = body.match(/```json\n(\{[\s\S]*?\})\n```/);
  expect(m).toBeTruthy();
  return JSON.parse(m![1]!) as {
    code: string;
    message: string;
    help: string;
    path: string;
    span: { start: number; end: number; line: number; column: number };
  };
}

describe("error-code catalogue (DOC-05)", () => {
  const errorsMd = readFileSync(join(ROOT, "docs/errors.md"), "utf8");
  const catalogue = parseCatalogue(errorsMd);
  const emitted = scanEmittedCodes();

  test("emitted codes and catalogue headings are the same set", () => {
    const catalogSet = new Set(catalogue.codes);
    expect([...emitted].sort()).toEqual([...catalogSet].sort());
    expect(catalogue.codes.length).toBe(catalogSet.size);
  });

  test("help catalogue files are not treated as emit sites", () => {
    for (const f of HELP_CATALOGUE_FILES) {
      expect(isHelpCataloguePath(f)).toBe(true);
      expect(listEmitScanFiles()).not.toContain(f);
    }
    // Codes quoted only in help maps must not keep a stale catalogue entry alive.
    const helpsOnly = new Set<string>();
    for (const f of HELP_CATALOGUE_FILES) {
      for (const m of readFileSync(f, "utf8").matchAll(CODE_RE)) helpsOnly.add(m[1]!);
    }
    expect(helpsOnly.size).toBeGreaterThan(0);
    const withoutHelps = scanEmittedCodes();
    // Inject a synthetic "only in helps" check: every helps code still needs a
    // real emit elsewhere; if one were helps-only, set equality would fail.
    for (const code of helpsOnly) {
      expect(withoutHelps.has(code)).toBe(true);
    }
    // And scanning the help files alone must not be how we discover emissions.
    const fromHelpsAlone = new Set<string>();
    for (const f of HELP_CATALOGUE_FILES) {
      for (const m of readFileSync(f, "utf8").matchAll(CODE_RE)) fromHelpsAlone.add(m[1]!);
    }
    expect([...fromHelpsAlone].sort()).toEqual([...helpsOnly].sort());
  });

  test("each catalogue entry has required fields and sample JSON", () => {
    for (const code of catalogue.codes) {
      const body = catalogue.sections.get(code)!;
      expect(body).toMatch(/\*\*Severity:\*\*/);
      expect(body).toMatch(/\*\*Meaning:\*\*/);
      expect(body).toMatch(/\*\*Example:\*\*/);
      expect(body).toMatch(/\*\*Fix:\*\*/);
      expect(body).toMatch(/\*\*Help:\*\*/);
      expect(body).toMatch(/\*\*Spec:\*\*/);
      expect(body).toContain(`"code": "${code}"`);
      expect(body).toMatch(/"severity": "error"/);
      expect(body).toMatch(/"help":/);
      expect(catalogue.helps.get(code)!.length).toBeGreaterThan(0);
    }
  });

  test("sample JSON help matches a documented Help for that code", () => {
    for (const code of catalogue.codes) {
      const body = catalogue.sections.get(code)!;
      const sample = sampleJson(body);
      expect(sample.code).toBe(code);
      expect(catalogue.helps.get(code)).toContain(sample.help);
      expect(sample.span.end).toBeGreaterThanOrEqual(sample.span.start);
      expect(sample.span.line).toBeGreaterThanOrEqual(1);
      expect(sample.span.column).toBeGreaterThanOrEqual(1);
    }
  });

  test("E_TYPE_UNBOUND sample JSON matches the n+1 example (op-spacing help)", () => {
    const body = catalogue.sections.get("E_TYPE_UNBOUND")!;
    expect(body).toContain("let x = n+1");
    const sample = sampleJson(body);
    expect(sample.message).toBe("unbound variable n+1");
    expect(sample.help).toBe(
      "operators need a space on both sides; did you mean `n + 1`?",
    );
    expect(sample.span).toEqual({ start: 8, end: 11, line: 1, column: 9 });
  });

  test("sample spans are not the universal placeholder 0/1", () => {
    const placeholder = { start: 0, end: 1, line: 1, column: 1 };
    const placeholders: string[] = [];
    for (const code of catalogue.codes) {
      const sample = sampleJson(catalogue.sections.get(code)!);
      if (
        sample.span.start === placeholder.start &&
        sample.span.end === placeholder.end &&
        sample.span.line === placeholder.line &&
        sample.span.column === placeholder.column
      ) {
        placeholders.push(code);
      }
    }
    expect(placeholders).toEqual([]);
  });

  test("catalogue help strings appear in host and Menard sources", () => {
    const files: string[] = [];
    collectFiles(join(ROOT, "host/src"), files);
    collectFiles(join(ROOT, "src"), files);
    const blob = files.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const [, helps] of catalogue.helps) {
      for (const help of helps) {
        expect(blob).toContain(help);
      }
    }
    for (const [code, help] of Object.entries(CATALOGUE_HELPS)) {
      expect(catalogue.helps.get(code)).toContain(help);
    }
    for (const [code, variants] of Object.entries(CATALOGUE_HELP_VARIANTS)) {
      for (const v of variants) {
        expect(catalogue.helps.get(code)).toContain(v);
        expect(blob).toContain(v);
      }
    }
  });

  test("phase headings each have a preamble before code entries", () => {
    for (const phase of PHASES) {
      const re = new RegExp(`## ${phase}\\n\\n([^#]+)`, "m");
      const m = errorsMd.match(re);
      expect(m).toBeTruthy();
      expect(m![1]!.trim().length).toBeGreaterThan(20);
    }
  });

  test("stability policy: stable within an edition; deprecated, not reused", () => {
    expect(errorsMd).toMatch(/stable within an edition/i);
    expect(errorsMd).toMatch(/deprecated,\s*not reused/i);
  });

  test("README, AGENTS.md, and the guide link the catalogue", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    const guide = readFileSync(join(ROOT, "docs/guide.md"), "utf8");
    expect(readme).toMatch(/errors\.md/);
    expect(agents).toMatch(/errors\.md/);
    expect(guide).toMatch(/errors\.md/);
  });

  test("HEADING_RE covers every catalogue code once", () => {
    const headings = [...errorsMd.matchAll(HEADING_RE)].map((m) => m[1]!);
    expect(headings).toEqual(catalogue.codes);
  });

  test("reserved Scope codes are documented without ### emit headings", () => {
    expect(errorsMd).toMatch(/## Reserved/);
    for (const code of RESERVED_SCOPE_CODES) {
      expect(errorsMd).toContain(code);
      expect(catalogue.codes).not.toContain(code);
      expect(emitted.has(code)).toBe(false);
      // Full catalogue fields under #### (not ### emit headings).
      expect(errorsMd).toMatch(
        new RegExp(`#### \`${code}\`[\\s\\S]*?\\*\\*Severity:\\*\\*[\\s\\S]*?\\*\\*Meaning:\\*\\*[\\s\\S]*?\\*\\*Example:\\*\\*[\\s\\S]*?\\*\\*Fix:\\*\\*[\\s\\S]*?\\*\\*Help:\\*\\*[\\s\\S]*?\\*\\*Spec:\\*\\*`),
      );
    }
    expect(errorsMd).toMatch(/E_OPERATOR_SPACING[\s\S]*E_TYPE_UNBOUND/);
  });

  test("sample messages appear in host emit sources (not invented)", () => {
    const files: string[] = [];
    collectFiles(join(ROOT, "host/src"), files);
    collectFiles(join(ROOT, "src"), files);
    const blob = files.map((f) => readFileSync(f, "utf8")).join("\n");
    // Stable fragments from templated or role-parameterized emit sites.
    const fragments: Record<string, string> = {
      E_PARSE: "unexpected character",
      E_PARSE_UNCLOSED: "unclosed",
      E_PARSE_BANG: "may appear only as the final character of an identifier",
      E_PARSE_STRING: "unterminated string",
      E_CASING: "must begin with an uppercase letter",
      E_DESUGAR_ARITY: "expects ",
      E_TYPE_MISMATCH: "expected ${typeShow(ta)}, found ${typeShow(tb)}",
      E_TYPE_DUPLICATE: "is already defined",
      E_TYPE_UNBOUND: "unbound variable",
      E_TYPE_NULLARY_CALL: "nullary constructor",
      E_TYPE_EXHAUSTIVE: "non-exhaustive match:",
      E_TYPE_UNKNOWN: "unknown type",
      E_TYPE_ORDERABLE: "is not orderable",
      E_TYPE_SHOWABLE: "is not showable",
      E_TYPE_ARITY: "function arity mismatch:",
      E_TYPE_OCCURS: "infinite type",
      E_TYPE_RECUR: "recur outside loop",
      E_IMPORT: "module does not export",
      E_IMPORT_CYCLE: "import cycle:",
      E_IMPORT_MISSING: "module not found:",
      E_IMPORT_VERSION: "two versions of",
      E_PUB_PRIVATE_TYPE: "pub signature mentions private type",
      E_TEST: "assertion failed:",
    };
    for (const code of catalogue.codes) {
      const sample = sampleJson(catalogue.sections.get(code)!);
      const needle = fragments[code] ?? sample.message;
      expect(blob.includes(needle), `${code}: missing ${needle}`).toBe(true);
    }
  });

  test("sample JSON has no machine-local temp paths", () => {
    expect(errorsMd).not.toMatch(/\/var\/folders\//);
    expect(errorsMd).not.toMatch(/\/tmp\/cat-/);
    for (const code of catalogue.codes) {
      const sample = sampleJson(catalogue.sections.get(code)!);
      expect(sample.message).not.toMatch(/\/var\/folders\//);
      expect(sample.path).toBe("a.mnd");
    }
  });

  test("surface-reachable catalogue samples match live diagnose", () => {
    const surface: Record<string, string> = {
      E_PARSE: "a==b\n",
      E_PARSE_UNCLOSED: "(1 + 2\n",
      E_PARSE_BANG: "foo!bar\n",
      E_PARSE_STRING: '"hello\n',
      E_CASING: "type color =\n  | Red\n",
      E_DESUGAR_ARITY: "f/(1.0)\n",
      E_DESUGAR_PIPE: "1 |> 2\n",
      E_TYPE_REST: "let f(xs: Int ...) -> Int = 0\n",
      E_TYPE_SPREAD: "f(...1)\n",
      E_TYPE_ARITY: "let f(x: Int, y: Int) -> Int =\n  x + y\nf(1)\n",
      E_TYPE_DUPLICATE: "type Color =\n  | Red\ntype Color =\n  | Blue\n",
      E_TYPE_EXHAUSTIVE:
        "type Color =\n  | Red\n  | Blue\nlet f(c: Color) -> Int =\n  match (c)\n    | Red -> 1\n",
      E_TYPE_FN: "let f(g: (Fn Int Int)) -> Int = 0\n",
      E_TYPE_MISMATCH: "1 + false\n",
      E_TYPE_NULLARY_CALL: "None()\n",
      E_TYPE_ORDERABLE: "compare(fn (x) = x, fn (y) = y)\n",
      E_TYPE_RECUR: "recur()\n",
      E_TYPE_SHOWABLE: "show(fn (x) = x)\n",
      E_TYPE_UNBOUND: "let x = n+1\n",
      E_TYPE_UNKNOWN: "let f(x: Int64) -> Int = 0\n",
    };
    for (const [code, src] of Object.entries(surface)) {
      const sample = sampleJson(catalogue.sections.get(code)!);
      const hit = diagnose(src).find((d) => d.code === code);
      expect(hit, code).toBeTruthy();
      expect(hit!.message).toBe(sample.message);
      expect(hit!.help).toBe(sample.help);
      expect(hit!.span).toEqual({
        start: sample.span.start,
        end: sample.span.end,
      });
    }
  });

  test("module catalogue samples match diagnose with stable virtual paths", () => {
    const hostWith = (files: Record<string, string>) =>
      createHost({ fs: createVirtualFs(files) });

    const cases: {
      code: string;
      files: Record<string, string>;
      path: string;
    }[] = [
      {
        code: "E_IMPORT_CYCLE",
        files: {
          "/a.mnd": 'import "./b.mnd"\n',
          "/b.mnd": 'import "./a.mnd"\n',
        },
        path: "/a.mnd",
      },
      {
        code: "E_IMPORT_MISSING",
        files: { "/a.mnd": 'import "./missing.mnd"\n' },
        path: "/a.mnd",
      },
      {
        code: "E_IMPORT_VERSION",
        files: {
          "/a.mnd": "import github:o/r@v1/a\nimport github:o/r@v2/b\n",
        },
        path: "/a.mnd",
      },
      {
        code: "E_EXTERN_SEAM",
        files: { "/a.mnd": "extern mn_foo() -> Int\n" },
        path: "/a.mnd",
      },
      {
        code: "E_RUNTIME_MODULE",
        files: { "/a.mnd": "runtime foo() -> Int\n" },
        path: "/a.mnd",
      },
      {
        code: "E_EXTERN_FFI_PREFIX",
        files: {
          "/examples/ffi/bad.mnd": "extern mn_exists(path: Str) -> Bool\n",
        },
        path: "/examples/ffi/bad.mnd",
      },
      {
        code: "E_IMPORT",
        files: {
          "/color.mnd": "pub type Color =\n  | Red\n",
          "/wrap.mnd": 'pub import "./color.mnd" (Missing)\n',
          "/a.mnd": 'import "./wrap.mnd"\n1\n',
        },
        path: "/a.mnd",
      },
      {
        code: "E_PUB_PRIVATE_TYPE",
        files: {
          "/a.mnd":
            "type Hidden =\n  | H(Int)\n\npub let make(n: Int) -> Hidden =\n  H(n)\n",
        },
        path: "/a.mnd",
      },
    ];

    for (const { code, files, path } of cases) {
      const sample = sampleJson(catalogue.sections.get(code)!);
      const host = hostWith(files);
      const src = host.readFile(path);
      expect(src.ok).toBe(true);
      if (!src.ok) continue;
      const hit = diagnose(src.bytes, { path, host }).find((d) => d.code === code);
      expect(hit, code).toBeTruthy();
      expect(hit!.message).toBe(sample.message);
      expect(hit!.help).toBe(sample.help);
    }
  });

  test("core-form catalogue messages match desugar/type emitters", () => {
    const enc = new TextEncoder();
    const sp = { start: 0, end: 4 };
    const sym = (n: string, s = sp) => ({
      tag: "sym" as const,
      name: enc.encode(n),
      span: s,
    });
    const list = (elems: any[], s = sp) => ({
      tag: "list" as const,
      kind: "paren" as const,
      elems,
      span: s,
    });

    const desugarCases: [string, any][] = [
      ["E_DESUGAR_COND_EMPTY", list([sym("cond")])],
      ["E_DESUGAR_COND_CLAUSE", list([sym("cond"), sym("true")])],
      [
        "E_DESUGAR_COND_ELSE",
        list([
          sym("cond"),
          list([sym("else"), { tag: "int", value: 0n, span: sp }]),
          list([sym("true"), { tag: "int", value: 1n, span: sp }]),
        ]),
      ],
      ["E_DESUGAR_WHEN", list([sym("when")])],
      ["E_DESUGAR_WHILE", list([sym("while")])],
      ["E_DESUGAR_MATCH", list([sym("mmatch")])],
      [
        "E_DESUGAR_MAP",
        list(
          [sym("map-lit", { start: 0, end: 5 }), { tag: "int", value: 1n, span: { start: 2, end: 3 } }],
          { start: 0, end: 5 },
        ),
      ],
    ];
    for (const [code, form] of desugarCases) {
      const sample = sampleJson(catalogue.sections.get(code)!);
      const r = desugarAll([form]);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      const hit = r.diagnostics.find((d) => d.code === code);
      expect(hit, code).toBeTruthy();
      expect(hit!.message).toBe(sample.message);
      expect(hit!.help).toBe(sample.help);
    }

    const typeCases: [string, any][] = [
      ["E_TYPE_LET", list([sym("let")])],
      ["E_TYPE_LOOP", list([sym("loop")])],
      ["E_TYPE_MATCH", list([sym("match")])],
      ["E_TYPE_DEFN", list([sym("defn"), sym("f")])],
    ];
    for (const [code, form] of typeCases) {
      const sample = sampleJson(catalogue.sections.get(code)!);
      const hit = typecheckForms([form]).diagnostics.find((d) => d.code === code);
      expect(hit, code).toBeTruthy();
      expect(hit!.message).toBe(sample.message);
      expect(hit!.help).toBe(sample.help);
    }
  });
});
