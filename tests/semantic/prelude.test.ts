import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../host/src/interp/index.ts";

describe("prelude", () => {
  test("core.mnd typechecks and loads", () => {
    const path = join(import.meta.dir, "../../prelude/core.mnd");
    const src = new Uint8Array(readFileSync(path));
    // append a use
    const enc = new TextEncoder();
    const prog = new Uint8Array(src.length + enc.encode("\n(not true)").length);
    prog.set(src);
    prog.set(enc.encode("\n(not true)"), src.length);
    const r = run(prog);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "bool") expect(r.value.value).toBe(false);
  });
});
