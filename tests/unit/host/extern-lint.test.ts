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

describe("extern seam", () => {
  test("extern appears only in sys, io, fs, and proc", () => {
    const files: string[] = [];
    mndFiles(ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      if (seam.has(file)) continue;
      const text = codeOf(file);
      if (/\(extern(\s|\))/.test(text) || /\(pub\s+extern(\s|\))/.test(text)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});

const publishedBang = new Set([
  "set!",
  "sb-append!",
  "sb-append-byte!",
  "sb-clear!",
  "sb-take-str!",
]);

describe("published mutation names", () => {
  test("stdlib and prelude use only the five ! names", () => {
    const files: string[] = [];
    mndFiles(join(ROOT, "stdlib"), files);
    mndFiles(join(ROOT, "prelude"), files);
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
