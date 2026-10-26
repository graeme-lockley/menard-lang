import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveHost } from "../../../host/src/host/index.ts";
import { run } from "../../../host/src/interp/pipeline.ts";
import { diagnose } from "../../../host/src/interp/pipeline.ts";

const ROOT = join(import.meta.dir, "../../..");
const fixture = "tests/phase2/fixtures/qualified-ctor.mnd";

const source = (body: string) =>
  new TextEncoder().encode(`import std/json as Json

let main() -> Int {
${body}
  0
}
`);

describe("aliased imports and constructors", () => {
  test("qualified constructors typecheck and evaluate", () => {
    const chunks: Uint8Array[] = [];
    const host = createLiveHost({
      realFs: true,
      argv: [],
      stdout: { write: (b) => chunks.push(b) },
    });
    const r = run(source("  println(show(Json.JsonFloat(1.5)))"), {
      path: "tests/unit/type/qualified-ctor.mnd",
      host,
    });
    expect(r.ok).toBe(true);
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("(JsonFloat 1.5)\n");
  });

  test("constructors are not in unqualified scope", () => {
    const host = createLiveHost({ realFs: true, argv: [] });
    const diags = diagnose(source("  println(show(JsonFloat(1.5)))"), {
      path: "tests/unit/type/unqualified-ctor.mnd",
      host,
    });
    expect(diags.some((d) => d.code === "E_TYPE_UNBOUND")).toBe(true);
  });

  test("qualified types and patterns typecheck and evaluate", () => {
    const chunks: Uint8Array[] = [];
    const host = createLiveHost({
      realFs: true,
      argv: [],
      stdout: { write: (b) => chunks.push(b) },
    });
    const sourceBytes = new TextEncoder().encode(
      `import std/json as Json

let describe(j: Json.Json) -> Str =
  match (j)
    | Json.JsonFloat(x) -> "float"
    | Json.JsonNull -> "null"
    | _ -> "other"

let main() -> Int {
  println(describe(Json.JsonFloat(1.5)))
  println(describe(Json.JsonNull()))
  0
}
`,
    );
    const r = run(sourceBytes, {
      path: "tests/unit/type/qualified-pat.mnd",
      host,
    });
    expect(r.ok).toBe(true);
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("float\nnull\n");
  });
});

describe.skipIf(!Bun.which("clang"))("native aliased constructors", () => {
  test("mn run and mn build agree on qualified constructors", () => {
    const dir = mkdtempSync(join(tmpdir(), "menard-qual-ctor-"));
    try {
      const interpreted = spawnSync(
        process.execPath,
        ["run", "host/src/cli/menard.ts", "run", fixture],
        { cwd: ROOT, encoding: "utf8", timeout: 120_000 },
      );
      expect(interpreted.status).toBe(0);
      expect(interpreted.stdout).toBe("(JsonFloat 1.5)\nfloat\nint\nnull\n");

      const checkBare = spawnSync(
        process.execPath,
        ["run", "host/src/cli/menard.ts", "run", "src/mn.mnd", "--", "check", "tests/negative/bad-qualified-ctor.mnd"],
        { cwd: ROOT, encoding: "utf8", timeout: 120_000 },
      );
      expect(checkBare.status).not.toBe(0);
      expect(checkBare.stderr).toContain("E_TYPE_UNBOUND");

      const binary = join(dir, "qualified-ctor");
      const built = spawnSync(
        process.execPath,
        ["run", "host/src/cli/menard.ts", "run", "src/mn.mnd", "--", "build", fixture, "-o", binary, "--clean"],
        { cwd: ROOT, encoding: "utf8", timeout: 120_000 },
      );
      expect(built.status).toBe(0);
      expect(built.stderr).not.toContain("error");
      const native = spawnSync(binary, [], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, MENARD_HEAP_VERIFY: "1" },
      });
      expect(native.status).toBe(0);
      expect(native.stdout).toBe(interpreted.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
