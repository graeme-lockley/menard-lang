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

describe("extern seam", () => {
  test("extern appears only under stdlib/", () => {
    const files: string[] = [];
    mndFiles(ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      if (file.includes(`${join("stdlib")}/`)) continue;
      const text = readFileSync(file, "utf8")
        .split("\n")
        .map((line) => {
          const i = line.indexOf(";");
          return i < 0 ? line : line.slice(0, i);
        })
        .join("\n");
      if (/\(extern(\s|\))/.test(text) || /\(pub\s+extern(\s|\))/.test(text)) {
        offenders.push(file.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
