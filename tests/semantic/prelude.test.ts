import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../host/src/interp/index.ts";
import { createHost, createVirtualFs } from "../../host/src/host/index.ts";

describe("prelude", () => {
  test("core.mnd loads as a module via import", () => {
    const root = join(import.meta.dir, "../..");
    const read = (rel: string) => new TextDecoder().decode(readFileSync(join(root, rel)));
    const host = createHost({
      fs: createVirtualFs({
        "/prelude/core.mnd": read("prelude/core.mnd"),
        "/stdlib/sys.mnd": read("stdlib/sys.mnd"),
        "/stdlib/io.mnd": read("stdlib/io.mnd"),
        "/stdlib/fs.mnd": read("stdlib/fs.mnd"),
        "/stdlib/proc.mnd": read("stdlib/proc.mnd"),
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
