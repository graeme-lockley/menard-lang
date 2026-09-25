import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../host/src/interp/index.ts";
import { createHost, createVirtualFs } from "../../host/src/host/index.ts";

describe("prelude", () => {
  test("core.mnd loads as a module via import", () => {
    const prelude = new TextDecoder().decode(
      readFileSync(join(import.meta.dir, "../../prelude/core.mnd")),
    );
    const host = createHost({
      fs: createVirtualFs({
        "/prelude/core.mnd": prelude,
        "/main.mnd": `(import "./prelude/core.mnd")\n(not true)\n`,
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
