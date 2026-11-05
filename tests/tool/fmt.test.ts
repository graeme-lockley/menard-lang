/**
 * LANG-09 AC7 / TOOL-01 slice: `mn fmt` spaces AST binary ops and never
 * rewrites identifier bytes (`n+1` stays `n+1`).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { formatSource } from "../../host/src/fmt/format.ts";
import { readAll } from "../../host/src/reader/index.ts";
import { astEqual } from "../../host/src/reader/ast.ts";

const ROOT = join(import.meta.dir, "../..");
const HOST = join(ROOT, "host/src/cli/menard.ts");
const MN = join(ROOT, "mn");
const hasMn = existsSync(MN);
const enc = new TextEncoder();
const dec = new TextDecoder();

function fmtFile(src: string): { status: number | null; out: string; err: string } {
  const dir = mkdtempSync(join(tmpdir(), "menard-fmt-"));
  const path = join(dir, "t.mnd");
  writeFileSync(path, src);
  const r = spawnSync("bun", [HOST, "fmt", path], { encoding: "utf-8", cwd: ROOT });
  const out = existsSync(path) ? readFileSync(path, "utf-8") : "";
  return { status: r.status, out, err: r.stderr ?? "" };
}

describe("formatSource (AC7)", () => {
  test("spaces real binary operators", () => {
    const r = formatSource(enc.encode("let main() -> Int = 1  +  2\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(dec.decode(r.bytes)).toContain("1 + 2");
    expect(dec.decode(r.bytes)).not.toContain("1  +  2");
  });

  test("never rewrites identifier bytes", () => {
    const r = formatSource(enc.encode("let n+1 = 0\nlet main() -> Int = n+1\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = dec.decode(r.bytes);
    expect(text).toContain("n+1");
    expect(text).not.toContain("n + 1");
  });

  test("formatting preserves the AST", () => {
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
});

describe("menard fmt CLI (AC7)", () => {
  test("rewrites a file to space binary ops", () => {
    const r = fmtFile("let main() -> Int = 1  +  2\n");
    expect(r.status).toBe(0);
    expect(r.out).toContain("1 + 2");
    expect(r.out).not.toContain("1  +  2");
  });

  test("leaves glued identifiers alone", () => {
    const r = fmtFile("let n+1 = 0\nlet main() -> Int = n+1\n");
    expect(r.status).toBe(0);
    expect(r.out).toContain("n+1");
    expect(r.out).not.toContain("n + 1");
  });

  test("menard fmt --help exits 0", () => {
    const r = spawnSync("bun", [HOST, "fmt", "--help"], { encoding: "utf-8", cwd: ROOT });
    expect(r.status).toBe(0);
    expect(r.stdout ?? "").toContain("usage: menard fmt");
  });
});

describe.skipIf(!hasMn)("native ./mn fmt (AC7)", () => {
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
