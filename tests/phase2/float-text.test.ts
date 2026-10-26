/**
 * LANG-02: shared float-text vectors — TypeScript formatFloat, C fixture,
 * and read(show) round-trip.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatFloat } from "../../host/src/interp/float-text.ts";
import { showValue } from "../../host/src/interp/derive.ts";
import { read } from "../../host/src/reader/read.ts";
import { runtimeInclude, runtimeThirdPartyInclude } from "../helpers/runtime-link.ts";

const ROOT = join(import.meta.dir, "../..");
const VECTORS = join(ROOT, "tests/vectors/float-text.jsonl");

type Row = { name: string; bits: string; text: string };

function loadVectors(): Row[] {
  return readFileSync(VECTORS, "utf8")
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Row);
}

function bitsToNumber(hex: string): number {
  const u = BigInt("0x" + hex.padStart(16, "0"));
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigUInt64LE(u);
  return buf.readDoubleLE(0);
}

function whichClang(): string | null {
  const onPath = Bun.which("clang");
  if (onPath !== null) return onPath;
  for (const prefix of ["/opt/homebrew/opt/llvm/bin", "/usr/local/opt/llvm/bin"]) {
    const candidate = join(prefix, "clang");
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      /* absent */
    }
  }
  return null;
}

const clang = whichClang();
const rows = loadVectors();

describe("float-text vectors (LANG-02)", () => {
  test("TypeScript formatFloat matches every vector", () => {
    for (const row of rows) {
      const d = bitsToNumber(row.bits);
      expect(formatFloat(d), row.name).toBe(row.text);
      expect(showValue({ tag: "float", value: d }), row.name).toBe(row.text);
    }
  });

  test("read(show(x)) recovers bits for every vector", () => {
    for (const row of rows) {
      const d = bitsToNumber(row.bits);
      const shown = formatFloat(d);
      const r = read(shown);
      expect(r.ok, row.name).toBe(true);
      if (!r.ok) continue;
      expect(r.ast.tag, row.name).toBe("float");
      if (r.ast.tag !== "float") continue;
      if (row.name === "nan") {
        expect(Number.isNaN(r.ast.value), row.name).toBe(true);
      } else {
        const out = Buffer.alloc(8);
        out.writeDoubleLE(r.ast.value, 0);
        const outHex = out.readBigUInt64LE(0).toString(16).padStart(16, "0");
        expect(outHex, row.name).toBe(row.bits);
      }
    }
  });
});

describe.skipIf(clang === null)("float-text C fixture", () => {
  test("mn_format_float matches every vector", () => {
    const dir = mkdtempSync(join(tmpdir(), "menard-float-text-"));
    try {
      const bin = join(dir, "format_float_main");
      const built = spawnSync(
        clang!,
        [
          "-std=c11",
          "-O2",
          "-D_DEFAULT_SOURCE",
          "-I",
          runtimeInclude(ROOT),
          "-I",
          runtimeThirdPartyInclude(ROOT),
          join(ROOT, "runtime/fixtures/format_float_main.c"),
          join(ROOT, "runtime/src/float_text.c"),
          join(ROOT, "runtime/third_party/ryu/d2s.c"),
          "-o",
          bin,
          "-lm",
        ],
        { encoding: "utf8" },
      );
      expect(built.status).toBe(0);
      expect(built.stderr).toBe("");
      const input = rows.map((r) => r.bits).join("\n") + "\n";
      const run = spawnSync(bin, [], { input, encoding: "utf8" });
      expect(run.status).toBe(0);
      const lines = run.stdout.trim().split("\n");
      expect(lines.length).toBe(rows.length);
      for (let i = 0; i < rows.length; i++) {
        expect(lines[i], rows[i]!.name).toBe(rows[i]!.text);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
