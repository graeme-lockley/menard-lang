import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const testsRoot = join(import.meta.dir, "..");

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".ts") || name.endsWith(".mnd")) out.push(path);
  }
}

describe("spawn fence", () => {
  test("spawnEnabled: true appears only under tests/proc", () => {
    const files: string[] = [];
    walk(testsRoot, files);
    const hits: string[] = [];
    for (const path of files) {
      const rel = relative(testsRoot, path);
      if (rel.startsWith("proc/") || rel.startsWith(`proc${"\\"}`)) continue;
      const text = readFileSync(path, "utf8");
      if (text.includes("spawnEnabled: true")) hits.push(rel);
    }
    expect(hits).toEqual([]);
  });
});
