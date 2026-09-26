import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { diagnose, run } from "../../../host/src/interp/pipeline.ts";
import {
  createHost,
  createRealHost,
  resolveSpawnCmd,
  validateSpawnArgv,
} from "../../../host/src/host/index.ts";

const stub = join(import.meta.dir, "../../../stub-child/main.ts");
const bun = process.execPath;

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

  test("empty argv is InvalidArgument", () => {
    const real = createRealHost({ spawnEnabled: true });
    const r = run(`(spawn (Nil))`, { host: real });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant") {
      expect(r.value.ctor).toBe("Err");
      const err = r.value.payloads[0];
      if (err?.tag === "variant") expect(err.ctor).toBe("InvalidArgument");
    }
  });

  test("NUL in an argument is InvalidArgument", () => {
    const real = createRealHost({ spawnEnabled: true });
    // Str with a NUL via StringBuffer — Char literals are not yet available.
    const r = run(
      `(let sb (sb-new)
         (do
           (sb-append! sb "a")
           (sb-append-byte! sb 0)
           (spawn (Cons (sb-to-str sb) (Nil)))))`,
      { host: real },
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant") {
      expect(r.value.ctor).toBe("Err");
      const err = r.value.payloads[0];
      if (err?.tag === "variant") expect(err.ctor).toBe("InvalidArgument");
    }
  });

  test("missing argv[0] is NotFound", () => {
    const real = createRealHost({ spawnEnabled: true });
    const r = run(`(spawn ${listStr("./no-such-menard-child-xyz")})`, {
      host: real,
    });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant") {
      expect(r.value.ctor).toBe("Err");
      const err = r.value.payloads[0];
      if (err?.tag === "variant") expect(err.ctor).toBe("NotFound");
    }
  });

  test("spawn stub-child exit status", () => {
    const real = createRealHost({ spawnEnabled: true });
    const r = run(
      `(spawn ${listStr(bun, stub, "exit", "42")})`,
      { host: real },
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant") {
      expect(r.value.ctor).toBe("Ok");
      const st = r.value.payloads[0];
      expect(st?.tag).toBe("variant");
      if (st?.tag === "variant") {
        expect(st.ctor).toBe("Exited");
        expect(st.payloads[0]).toEqual({ tag: "int", value: 42n });
      }
    }
  });

  test("spawn-capture feeds stdin and captures stdout", () => {
    const real = createRealHost({ spawnEnabled: true });
    const r = run(
      `(spawn-capture ${listStr(bun, stub, "cat-stdin")} "hi")`,
      { host: real },
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant" && r.value.ctor === "Ok") {
      const out = r.value.payloads[0];
      expect(out?.tag).toBe("record");
      if (out?.tag === "record") {
        expect(out.name).toBe("SpawnOutput");
        const status = out.fields[0];
        const stdout = out.fields[1];
        expect(status?.tag).toBe("variant");
        if (status?.tag === "variant") {
          expect(status.ctor).toBe("Exited");
          expect(status.payloads[0]).toEqual({ tag: "int", value: 0n });
        }
        expect(stdout?.tag).toBe("str");
        if (stdout?.tag === "str") {
          expect(new TextDecoder().decode(stdout.bytes)).toBe("hi");
        }
      }
    }
  });

  test("spawn and spawn-capture typecheck", () => {
    const diags = diagnose(`(do
  (spawn (Cons "x" (Nil)))
  (spawn-capture (Cons "x" (Nil)) ""))`);
    expect(diags).toEqual([]);
  });
});
