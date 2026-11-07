/**
 * TOOL-01: `mn fmt` / `mn fmt --check` — goldens, idempotence, comments, CLI.
 */
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { formatSource } from "../../host/src/fmt/format.ts";
import { scanTrivia } from "../../host/src/fmt/trivia.ts";
import { readAll } from "../../host/src/reader/index.ts";
import { astEqual } from "../../host/src/reader/ast.ts";
import { print } from "../../host/src/reader/print.ts";
import type { Ast } from "../../host/src/reader/ast.ts";

const ROOT = join(import.meta.dir, "../..");
const HOST = join(ROOT, "host/src/cli/menard.ts");
const MN = join(ROOT, "mn");
const hasMn = existsSync(MN);
const enc = new TextEncoder();
const dec = new TextDecoder();

type FormatOut =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; message: string; help?: string };

function fmt(src: string): FormatOut {
  const r = formatSource(enc.encode(src));
  if (!r.ok) return { ok: false, message: r.message, help: r.help };
  return { ok: true, text: dec.decode(r.bytes), changed: r.changed };
}

function fmtFile(
  src: string,
  extra: string[] = [],
): { status: number | null; out: string; err: string; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), "menard-fmt-"));
  const path = join(dir, "t.mnd");
  writeFileSync(path, src);
  const r = spawnSync("bun", [HOST, "fmt", ...extra, path], {
    encoding: "utf-8",
    cwd: ROOT,
  });
  const out = existsSync(path) ? readFileSync(path, "utf-8") : "";
  return {
    status: r.status,
    out,
    err: r.stderr ?? "",
    stdout: r.stdout ?? "",
  };
}

function walkMnd(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "negative") continue;
      walkMnd(p, acc);
    } else if (name.endsWith(".mnd")) acc.push(p);
  }
  return acc;
}

describe("trivia scan", () => {
  test("empty file", () => {
    const r = scanTrivia(enc.encode(""));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toEqual([]);
  });

  test("shebang-only", () => {
    const r = scanTrivia(enc.encode("#!/usr/bin/env mn\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.kind).toBe("shebang");
    expect(r.items[0]!.text).toBe("#!/usr/bin/env mn");
  });

  test("comment-only", () => {
    const r = scanTrivia(enc.encode("; hello\n; world\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => i.text)).toEqual(["; hello", "; world"]);
  });

  test("CRLF rejection", () => {
    const r = scanTrivia(enc.encode("let x = 1\r\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("CRLF");
  });
});

describe("layout goldens (AC9)", () => {
  test("empty file", () => {
    const r = fmt("");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe("");
  });

  test("binary op spacing", () => {
    const r = fmt("let main() -> Int = 1  +  2\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe("let main() -> Int =\n  1 + 2\n");
  });

  test("nested arms", () => {
    const src = `let main(x: Int) -> Int =
  match (x)
    | 0 ->
      match (x)
        | 0 -> 1
        | n -> n
    | n -> n
`;
    const r = fmt(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe(
      "let main(x: Int) -> Int =\n  match (x)\n    | 0 ->\n      match (x)\n        | 0 -> 1\n        | n -> n\n    | n -> n\n",
    );
    const again = fmt(r.text);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.text).toBe(r.text);
  });

  test("match in a call", () => {
    const src = `let main(x: Int) -> Int = f(match (x)
  | 0 -> 1
  | n -> n)
`;
    const r = fmt(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe(
      "let main(x: Int) -> Int =\n  f(\n    match (x)\n      | 0 -> 1\n      | n -> n\n  )\n",
    );
    const again = fmt(r.text);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.text).toBe(r.text);
  });

  test("long imports stay packed", () => {
    const src = `import "./aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mnd"
import "./bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mnd" as B
let main() -> Int = 0
`;
    const r = fmt(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain(
      'import "./aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mnd"\nimport "./bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mnd" as B\n\n',
    );
  });

  test("block braces and indent", () => {
    const src = `let main() -> Int {
let x = 1
x + 1
}
`;
    const r = fmt(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe("let main() -> Int {\n  let x = 1\n  x + 1\n}\n");
  });

  test("string escapes keep newlines escaped", () => {
    // AST printer escapes `\n`/`\r`/`\t` so fmt never writes raw CR into a file.
    const r = fmt('let main() -> Str = "a\\nb"\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain('"a\\nb"');
    expect(r.text).not.toMatch(/"a\nb"/);
  });

  test("Module.func calls stay Module.func(args)", () => {
    const r = fmt('import std/string as String\nlet main() -> Int = String.length("hi")\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain('String.length("hi")');
    expect(r.text).not.toContain("(String.length)");
  });
});

describe("comments / shebang / #source (AC5)", () => {
  test("@test and doc comments preserved", () => {
    const src = `; @module demo
; A helper.
; @test add(1, 2) => 3
let add(a: Int, b: Int) -> Int = a + b
`;
    const r = fmt(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("; @module demo");
    expect(r.text).toContain("; A helper.");
    expect(r.text).toContain("; @test add(1, 2) => 3");
  });

  test("shebang preserved", () => {
    const src = `#!/usr/bin/env mn
let main() -> Int = 0
`;
    const r = fmt(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text.startsWith("#!/usr/bin/env mn\n")).toBe(true);
  });

  test("#source mapping preserved", () => {
    const src = `; #source examples/sc.mnd:12
let main() -> Int = 0
`;
    const r = fmt(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("; #source examples/sc.mnd:12");
  });

  test("nested comment between stmts", () => {
    const src = `let main() -> Int {
  let x = 1
  ; keep me
  x + 1
}
`;
    const r = fmt(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("  ; keep me\n");
  });

  test("multi-line @test { } block layout", () => {
    const src = `; @test {
;   add(1, 2) => 3
;   add(0, 0) => 0
; }
let add(a: Int, b: Int) -> Int = a + b
`;
    const r = fmt(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe(
      "; @test {\n;   add(1, 2) => 3\n;   add(0, 0) => 0\n; }\nlet add(a: Int, b: Int) -> Int =\n  a + b\n",
    );
    const again = fmt(r.text);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.text).toBe(r.text);
  });
});

describe("idempotence (AC3)", () => {
  test("fmt(fmt(x)) == fmt(x) golden", () => {
    const src = `; @test main() => 3
let main() -> Int = 1  +  2
`;
    const a = fmt(src);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = fmt(a.text);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.text).toBe(a.text);
  });

  test("fmt(fmt(x)) == fmt(x) for every repo .mnd", () => {
    const roots = ["src", "stdlib", "examples", "tests"].map((d) => join(ROOT, d));
    const files = roots.flatMap((d) => walkMnd(d));
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const raw = new Uint8Array(readFileSync(path));
      expect(raw.includes(0x0d), `CRLF in ${relative(ROOT, path)}`).toBe(false);
      const once = formatSource(raw);
      expect(once.ok, `format failed for ${relative(ROOT, path)}: ${once.ok ? "" : once.message}`).toBe(
        true,
      );
      if (!once.ok) return;
      const twice = formatSource(once.bytes);
      expect(twice.ok, `re-format failed for ${relative(ROOT, path)}`).toBe(true);
      if (!twice.ok) return;
      expect(dec.decode(twice.bytes)).toBe(dec.decode(once.bytes));
    }
  });
});

describe("AST preservation (AC4)", () => {
  test("spaces ops without changing AST", () => {
    const src = enc.encode("let main() -> Int = 1  +  2\n");
    const before = readAll(src);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const r = formatSource(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = readAll(r.bytes);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(astEqual(before.forms[0]!, after.forms[0]!)).toBe(true);
  });

  test("comments do not alter AST", () => {
    const src = enc.encode("; doc\nlet main() -> Int = 1 + 2\n");
    const before = readAll(src);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const r = formatSource(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = readAll(r.bytes);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(astEqual(before.forms[0]!, after.forms[0]!)).toBe(true);
  });

  test("nested if stays if (no rewrite to cond)", () => {
    const src = enc.encode("let main(a: Bool, b: Bool) -> Int =\n  if (a) -> 1 | if (b) -> 2 | 3\n");
    const before = readAll(src);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const r = formatSource(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = dec.decode(r.bytes);
    expect(text).toContain("if (a)");
    expect(text).toContain("if (b)");
    expect(text).not.toContain("cond");
    const after = readAll(r.bytes);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(astEqual(before.forms[0]!, after.forms[0]!)).toBe(true);
  });

  test("heavy if body stays if (no rewrite to cond)", () => {
    const src = enc.encode(
      "let main(a: Bool) -> Int =\n  if (a) -> {\n    let x = 1\n    x\n  } | 0\n",
    );
    const before = readAll(src);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const r = formatSource(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = dec.decode(r.bytes);
    expect(text).toContain("if (a)");
    expect(text).not.toMatch(/^cond/m);
    const after = readAll(r.bytes);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(astEqual(before.forms[0]!, after.forms[0]!)).toBe(true);
  });

  test("if with match else hangs so arms stay on match", () => {
    const src = enc.encode(`type Res =
  | Ok(Int)
  | Err(Str)

let main(a: Bool, x: Res) -> Int =
  if (a) -> {
    let y = 1
    y
  } | match (x)
    | Ok(n) -> n
    | Err(_) -> 0
`);
    const before = readAll(src);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const r = formatSource(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = dec.decode(r.bytes);
    expect(text).toContain("if (a)");
    expect(text).toContain("match (x)");
    expect(text).not.toContain("cond\n");
    expect(text).toMatch(/\|\n\s*match \(x\)/);
    const after = readAll(r.bytes);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.forms.length).toBe(before.forms.length);
    for (let i = 0; i < before.forms.length; i++) {
      expect(astEqual(before.forms[i]!, after.forms[i]!)).toBe(true);
    }
  });

  test("format → re-read AST equality for every repo .mnd", () => {
    const roots = ["src", "stdlib", "examples", "tests"].map((d) => join(ROOT, d));
    const files = roots.flatMap((d) => walkMnd(d));
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const raw = new Uint8Array(readFileSync(path));
      expect(raw.includes(0x0d), `CRLF in ${relative(ROOT, path)}`).toBe(false);
      const before = readAll(raw);
      expect(before.ok, `read failed for ${relative(ROOT, path)}`).toBe(true);
      if (!before.ok) return;
      const formatted = formatSource(raw);
      expect(
        formatted.ok,
        `format failed for ${relative(ROOT, path)}: ${formatted.ok ? "" : formatted.message}`,
      ).toBe(true);
      if (!formatted.ok) return;
      const after = readAll(formatted.bytes);
      expect(after.ok, `re-read failed for ${relative(ROOT, path)}`).toBe(true);
      if (!after.ok) return;
      expect(after.forms.length).toBe(before.forms.length);
      for (let i = 0; i < before.forms.length; i++) {
        expect(
          astEqual(before.forms[i]!, after.forms[i]!),
          `AST drift in ${relative(ROOT, path)} form ${i}`,
        ).toBe(true);
      }
    }
  });
});

describe("surface forms (AC7)", () => {
  test("bare None, Some(1), Point(1, 2), defer, ?", () => {
    const src = `type Maybe[a] =
  | None
  | Some(a)
record Point {
  x: Int
  y: Int
}
let main() -> Int {
  defer cleanup()
  let a = None
  let b = Some(1)
  let c = Point(1, 2)
  let d = x ? 0
  0
}
`;
    const r = fmt(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("| None\n");
    expect(r.text).not.toContain("None()");
    expect(r.text).toContain("Some(1)");
    expect(r.text).toContain("Point(1, 2)");
    expect(r.text).toContain("defer cleanup()");
    expect(r.text).toContain("x ? 0");
  });

  test("?? prints as a spaced binary op on synthetic AST", () => {
    const span = { start: 0, end: 0 };
    const qq: Ast = {
      tag: "list",
      kind: "paren",
      elems: [
        { tag: "sym", name: enc.encode("??"), span },
        { tag: "sym", name: enc.encode("x"), span },
        { tag: "int", value: 0n, span },
      ],
      span,
    };
    expect(dec.decode(print(qq))).toBe("x ?? 0");
  });

  test("?? round-trips through formatSource", () => {
    const r = fmt("let main(x: Int) -> Int = x  ??  0\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe("let main(x: Int) -> Int =\n  x ?? 0\n");
    const again = fmt(r.text);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.text).toBe(r.text);
    const before = readAll(enc.encode("let main(x: Int) -> Int = x ?? 0\n"));
    const after = readAll(enc.encode(r.text));
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(astEqual(before.forms[0]!, after.forms[0]!)).toBe(true);
  });
});

describe("identifier bytes (AC8)", () => {
  test("never rewrites identifier bytes", () => {
    const r = fmt("let n+1 = 0\nlet main() -> Int = n+1\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("n+1");
    expect(r.text).not.toContain("n + 1");
  });

  test("AST ops get exactly one space each side", () => {
    const r2 = fmt("let main() -> Int = 1  +  2\n");
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.text).toContain("1 + 2");
    expect(r2.text).not.toContain("1  +  2");
  });
});

describe("CRLF rejection (AC9)", () => {
  test("formatSource rejects CR", () => {
    const r = formatSource(enc.encode("let main() -> Int = 1\r\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("CRLF");
  });
});

describe("menard fmt CLI (AC1)", () => {
  test("rewrites a file", () => {
    const r = fmtFile("let main() -> Int = 1  +  2\n");
    expect(r.status).toBe(0);
    expect(r.out).toContain("1 + 2");
  });

  test("check-dirty writes unified diff on stderr and exits 1", () => {
    const r = fmtFile("let main() -> Int = 1  +  2\n", ["--check"]);
    expect(r.status).toBe(1);
    expect(r.err).toContain("---");
    expect(r.err).toContain("+++");
    expect(r.err).toContain("@@");
    expect(r.out).toContain("1  +  2");
  });

  test("check-clean exits 0", () => {
    const formatted = fmt("let main() -> Int = 1  +  2\n");
    expect(formatted.ok).toBe(true);
    if (!formatted.ok) return;
    const r = fmtFile(formatted.text, ["--check"]);
    expect(r.status).toBe(0);
    expect(r.err).toBe("");
  });

  test("--stdin writes formatted source to stdout", () => {
    const r = spawnSync("bun", [HOST, "fmt", "--stdin"], {
      encoding: "utf-8",
      cwd: ROOT,
      input: "let main() -> Int = 1  +  2\n",
    });
    expect(r.status).toBe(0);
    expect(r.stdout ?? "").toContain("1 + 2");
  });

  test("--stdin --check diffs stdin", () => {
    const r = spawnSync("bun", [HOST, "fmt", "--stdin", "--check"], {
      encoding: "utf-8",
      cwd: ROOT,
      input: "let main() -> Int = 1  +  2\n",
    });
    expect(r.status).toBe(1);
    expect(r.stderr ?? "").toContain("---");
  });

  test("menard fmt --help exits 0", () => {
    const r = spawnSync("bun", [HOST, "fmt", "--help"], { encoding: "utf-8", cwd: ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout ?? "").toContain("usage: menard fmt");
    expect(r.stdout ?? "").toContain("--check");
  });

  test("leaves glued identifiers alone", () => {
    const r = fmtFile("let n+1 = 0\nlet main() -> Int = n+1\n");
    expect(r.status).toBe(0);
    expect(r.out).toContain("n+1");
    expect(r.out).not.toContain("n + 1");
  });
});

// Optional native parity when `./mn` exists. CI `make fmt-check` and the
// host describe blocks above are the contract; this suite is not required
// for TOOL-01 acceptance on a host-only checkout.
describe.skipIf(!hasMn)("native ./mn fmt (optional parity)", () => {
  test("mn fmt spaces ops and preserves idents", () => {
    const dir = mkdtempSync(join(tmpdir(), "menard-fmt-native-"));
    const spaced = join(dir, "spaced.mnd");
    const glued = join(dir, "glued.mnd");
    writeFileSync(spaced, "let main() -> Int = 1  +  2\n");
    writeFileSync(glued, "let n+1 = 0\nlet main() -> Int = n+1\n");
    const a = spawnSync(MN, ["fmt", spaced], { encoding: "utf-8", cwd: ROOT });
    const b = spawnSync(MN, ["fmt", glued], { encoding: "utf-8", cwd: ROOT });
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    expect(readFileSync(spaced, "utf-8")).toContain("1 + 2");
    expect(readFileSync(glued, "utf-8")).toContain("n+1");
    expect(readFileSync(glued, "utf-8")).not.toContain("n + 1");
  });
});

describe("corpus relative paths helper", () => {
  test("walk finds .mnd under roots", () => {
    const files = walkMnd(join(ROOT, "stdlib"));
    expect(files.some((f) => relative(ROOT, f).startsWith("stdlib/"))).toBe(true);
  });
});
