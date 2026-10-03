import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../host/src/interp/pipeline.ts";
import { createRealHost, type Host } from "../../host/src/host/index.ts";

const scratch = mkdtempSync(join(tmpdir(), "menard-spawn-"));

function runProc(src: string, host: Host) {
  const path = join(scratch, "main.mnd");
  const text = `import std/proc\n${src}`;
  writeFileSync(path, text);
  return run(text, { path, host });
}

const stub = join(import.meta.dir, "../../stub-child/main.ts");
const bun = process.execPath;

function listStr(...xs: string[]): string {
  let acc = "Nil()";
  for (let i = xs.length - 1; i >= 0; i--) {
    acc = `Cons("${xs[i]!.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}", ${acc})`;
  }
  return acc;
}

describe("spawn (real child)", () => {
  test("empty argv is InvalidArgument", () => {
    const real = createRealHost({ spawnEnabled: true });
    const r = runProc(`spawn(Nil())`, real);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant") {
      expect(r.value.ctor).toBe("Err");
      const err = r.value.payloads[0];
      if (err?.tag === "variant") expect(err.ctor).toBe("InvalidArgument");
    }
  });

  test("NUL in an argument is InvalidArgument", () => {
    const real = createRealHost({ spawnEnabled: true });
    const r = runProc(
      `{
  let sb = sb-new()
  sb-append!(sb, "a")
  sb-append-byte!(sb, 0)
  spawn(Cons(sb-to-str(sb), Nil()))
}`,
      real,
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
    const r = runProc(`spawn(${listStr("./no-such-menard-child-xyz")})`, real);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant") {
      expect(r.value.ctor).toBe("Err");
      const err = r.value.payloads[0];
      if (err?.tag === "variant") expect(err.ctor).toBe("NotFound");
    }
  });

  test("spawn stub-child exit status", () => {
    const real = createRealHost({ spawnEnabled: true });
    const r = runProc(`spawn(${listStr(bun, stub, "exit", "42")})`, real);
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
    const r = runProc(`spawn-capture(${listStr(bun, stub, "cat-stdin")}, "hi")`, real);
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
});
