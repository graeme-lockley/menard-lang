import { describe, expect, test } from "bun:test";
import { diagnose, run } from "../../../host/src/interp/pipeline.ts";
import { createHost, resolveSpawnCmd, validateSpawnArgv } from "../../../host/src/host/index.ts";

function listStr(...xs: string[]): string {
  let acc = "(Nil)";
  for (let i = xs.length - 1; i >= 0; i--) {
    acc = `(Cons "${xs[i]!.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" ${acc})`;
  }
  return acc;
}

describe("spawn helpers", () => {
  test("bare names resolve to ./name", () => {
    expect(resolveSpawnCmd("cc")).toBe("./cc");
    expect(resolveSpawnCmd("/bin/true")).toBe("/bin/true");
    expect(resolveSpawnCmd("./rel")).toBe("./rel");
  });

  test("empty argv and NUL bytes are InvalidArgument", () => {
    expect(validateSpawnArgv([])).toEqual({ tag: "InvalidArgument" });
    expect(validateSpawnArgv([new Uint8Array([0x61, 0x00])])).toEqual({
      tag: "InvalidArgument",
    });
    expect(validateSpawnArgv([new TextEncoder().encode("ok")])).toBeNull();
  });
});

describe("spawn", () => {
  test("disabled host returns Unsupported", () => {
    const host = createHost({ spawnEnabled: false });
    const r = run(`(spawn ${listStr("/bin/true")})`, { host });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant") {
      expect(r.value.ctor).toBe("Err");
      const err = r.value.payloads[0];
      expect(err?.tag).toBe("variant");
      if (err?.tag === "variant") expect(err.ctor).toBe("Unsupported");
    }
  });

  test("spawn and spawn-capture typecheck", () => {
    const diags = diagnose(`(do
  (spawn (Cons "x" (Nil)))
  (spawn-capture (Cons "x" (Nil)) ""))`);
    expect(diags).toEqual([]);
  });
});
