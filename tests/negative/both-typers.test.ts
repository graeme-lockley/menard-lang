/**
 * One negative directory, two typers. Each `*.mnd` here is checked by the
 * host `diagnose` and by `src/mn.mnd check`. The diagnostic code and
 * message must match; a difference fails the test.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { diagnose } from "../../host/src/interp/index.ts";
import { run } from "../../host/src/interp/pipeline.ts";
import { createLiveHost } from "../../host/src/host/index.ts";

const dir = import.meta.dir;
const root = join(dir, "..", "..");

type Diag = { code: string; message: string };

function hostDiags(path: string): Diag[] {
  const source = readFileSync(path);
  return diagnose(source, { path }).map((d) => ({ code: d.code, message: d.message }));
}

function menardDiags(path: string): Diag[] {
  const entryPath = join(root, "src/mn.mnd");
  const source = readFileSync(entryPath);
  const stderrChunks: Uint8Array[] = [];
  const host = createLiveHost({
    realFs: true,
    argv: ["check", path],
    stdout: { write: () => {} },
    stderr: { write: (b: Uint8Array) => stderrChunks.push(b) },
  });
  const r = run(source, { path: entryPath, host });
  const stderr = stderrChunks.map((b) => new TextDecoder().decode(b)).join("");
  if (r.ok && r.exitCode === 0) {
    throw new Error(`src/mn.mnd check accepted ${path}`);
  }
  const out: Diag[] = [];
  for (const line of stderr.split("\n")) {
    const m = line.match(/: error: (.*) \[([A-Z][A-Z0-9_]*)\]$/);
    if (m) out.push({ message: m[1]!, code: m[2]! });
  }
  if (out.length === 0) {
    throw new Error(`no coded diagnostic from src/mn.mnd check of ${path}:\n${stderr}`);
  }
  return out;
}

const programs = readdirSync(dir)
  .filter((name) => name.endsWith(".mnd"))
  .sort();

describe("host diagnose and src/mn.mnd check agree", () => {
  for (const name of programs) {
    test(name, () => {
      const path = join(dir, name);
      expect(menardDiags(path)).toEqual(hostDiags(path));
    });
  }
});
