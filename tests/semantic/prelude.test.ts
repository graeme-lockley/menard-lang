import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../host/src/interp/index.ts";
import { createHost, createLiveHost, createVirtualFs } from "../../host/src/host/index.ts";

describe("std/basics", () => {
  test("not is in scope without an import", () => {
    const host = createHost({
      fs: createVirtualFs({
        "/main.mnd": "not(true)\n",
      }),
    });
    const src = host.readFile("/main.mnd");
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    const r = run(src.bytes, { path: "/main.mnd", host });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "bool") expect(r.value.value).toBe(false);
  });
});

describe("LANG-07 nullary constructors", () => {
  test("semantic fixture exits 0", () => {
    const path = join(import.meta.dir, "nullary-constructors.mnd");
    const source = new Uint8Array(readFileSync(path));
    const host = createLiveHost({ realFs: true, argv: [] });
    const r = run(source, { path, host });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(0n);
  });
});
