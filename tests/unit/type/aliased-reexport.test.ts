import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createLiveHost } from "../../../host/src/host/index.ts";
import { diagnose, run } from "../../../host/src/interp/pipeline.ts";
import { readFileSync } from "node:fs";

const ROOT = join(import.meta.dir, "../../..");

function hostDiagnose(rel: string) {
  const host = createLiveHost({ realFs: true, argv: [] });
  const path = join(ROOT, rel);
  const bytes = new Uint8Array(readFileSync(path));
  return diagnose(bytes, { path, host });
}

function mnCheck(rel: string) {
  // Host CI has no ./mn binary; bootstrap like qualified-ctor.test.ts.
  return spawnSync(
    process.execPath,
    ["run", "host/src/cli/menard.ts", "run", "src/mn.mnd", "--", "check", rel, "--clean"],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
    },
  );
}

describe("LANG-16 aliased re-exports", () => {
  test("host: alias-only Net typechecks without IoError import", () => {
    expect(hostDiagnose("tests/phase2/fixtures/aliased-reexport-net.mnd")).toEqual([]);
  });

  test("host: alias-only Actor typechecks without Cancelled import", () => {
    expect(hostDiagnose("tests/phase2/fixtures/aliased-reexport-actor.mnd")).toEqual([]);
  });

  test("host: alias + same-module selective keeps Json.JsonFloat", () => {
    const host = createLiveHost({
      realFs: true,
      argv: [],
      stdout: { write: () => {} },
    });
    const path = join(ROOT, "tests/phase2/fixtures/aliased-reexport-dual.mnd");
    const bytes = new Uint8Array(readFileSync(path));
    const r = run(bytes, { path, host });
    expect(r.ok).toBe(true);
  });

  test("host: Net.IoError is usable in annotations", () => {
    const host = createLiveHost({ realFs: true, argv: [] });
    const src = new TextEncoder().encode(`import std/net as Net

let boom(e: Net.IoError) -> Int =
  match (e)
    | Net.Unsupported -> 1
    | _ -> 0

let main() -> Int =
  boom(Net.Unsupported)
`);
    expect(diagnose(src, { path: join(ROOT, "tests/unit/type/net-ioerror.mnd"), host })).toEqual([]);
  });
});

describe.skipIf(!Bun.which("clang"))("LANG-16 native aliased re-exports", () => {
  test("mn check agrees on alias-only Net/Actor and dual Json", () => {
    for (const rel of [
      "tests/phase2/fixtures/aliased-reexport-net.mnd",
      "tests/phase2/fixtures/aliased-reexport-actor.mnd",
      "tests/phase2/fixtures/aliased-reexport-dual.mnd",
    ]) {
      const r = mnCheck(rel);
      expect(r.status, `${rel}: ${r.stderr}`).toBe(0);
    }
  }, 120_000);
});
