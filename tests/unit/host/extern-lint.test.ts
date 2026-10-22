import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");

function mndFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "build" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) mndFiles(p, out);
    else if (name.endsWith(".mnd")) out.push(p);
  }
}

const seam = new Set([
  join(ROOT, "stdlib/sys.mnd"),
  join(ROOT, "stdlib/io.mnd"),
  join(ROOT, "stdlib/fs.mnd"),
  join(ROOT, "stdlib/proc.mnd"),
  join(ROOT, "stdlib/time.mnd"),
  join(ROOT, "stdlib/sched.mnd"),
]);

function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => {
      const i = line.indexOf(";");
      return i < 0 ? line : line.slice(0, i);
    })
    .join("\n");
}

function isFfiPath(file: string): boolean {
  const rel = file.slice(ROOT.length + 1).replaceAll("\\", "/");
  return rel.includes("/ffi/") && !rel.startsWith("stdlib/");
}

function externNames(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/\bextern\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    names.push(m[1]!);
  }
  return names;
}

describe("extern seam", () => {
  test("extern appears only in seam modules or /ffi/ trees", () => {
    const files: string[] = [];
    mndFiles(ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      if (seam.has(file) || isFfiPath(file)) continue;
      const text = codeOf(file);
      // Top-level surface form only (ignore docs / sexpr mentions of the keyword).
      if (/^\s*extern\s+[A-Za-z_]/m.test(text)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });

  test("seam modules declare only mn_*; /ffi/ modules never declare mn_*", () => {
    const files: string[] = [];
    mndFiles(ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      const text = codeOf(file);
      const names = externNames(text);
      if (names.length === 0) continue;
      if (seam.has(file)) {
        for (const n of names) {
          if (!n.startsWith("mn_")) offenders.push(`${file.slice(ROOT.length + 1)}: ${n}`);
        }
      } else if (isFfiPath(file)) {
        for (const n of names) {
          if (n.startsWith("mn_")) offenders.push(`${file.slice(ROOT.length + 1)}: ${n}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

const publishedBang = new Set([
  "set!",
  "append!",
  "append-byte!",
  "append-show!",
  "clear!",
  "take-str!",
]);

describe("published mutation names", () => {
  test("stdlib uses only the published ! names", () => {
    const files: string[] = [];
    mndFiles(join(ROOT, "stdlib"), files);
    const offenders: string[] = [];
    for (const file of files) {
      const text = codeOf(file);
      for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9-]*!/g)) {
        const name = match[0];
        if (!publishedBang.has(name)) {
          offenders.push(`${file.slice(ROOT.length + 1)}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
