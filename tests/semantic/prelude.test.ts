import { describe, expect, test } from "bun:test";
import { run } from "../../host/src/interp/index.ts";
import { createHost, createVirtualFs } from "../../host/src/host/index.ts";

describe("std/basics", () => {
  test("not is in scope without an import", () => {
    const host = createHost({
      fs: createVirtualFs({
        "/main.mnd": "(not true)\n",
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
