import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { diagnose, run } from "../../../host/src/interp/pipeline.ts";
import { createHost, createVirtualFs } from "../../../host/src/host/index.ts";

function hostWith(files: Record<string, string>) {
  return createHost({ fs: createVirtualFs(files) });
}

describe("modules", () => {
  test("import brings in pub defn", () => {
    const host = hostWith({
      "/math.mnd": `(pub defn add (x: Int) (y: Int) -> Int (+ x y))\n(defn hidden (x: Int) -> Int x)\n`,
      "/main.mnd": `(import "./math.mnd")\n(add 2 3)\n`,
    });
    const src = host.readFile("/main.mnd");
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    const r = run(src.bytes, { path: "/main.mnd", host });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(5n);
  });

  test("private defn is not visible to importer", () => {
    const host = hostWith({
      "/math.mnd": `(defn hidden (x: Int) -> Int x)\n`,
      "/main.mnd": `(import "./math.mnd")\n(hidden 1)\n`,
    });
    const src = host.readFile("/main.mnd");
    if (!src.ok) return;
    const diags = diagnose(src.bytes, { path: "/main.mnd", host });
    expect(diags.some((d) => d.code === "E_TYPE_UNBOUND")).toBe(true);
  });

  test("import cycle is diagnosed", () => {
    const host = hostWith({
      "/a.mnd": `(import "./b.mnd")\n`,
      "/b.mnd": `(import "./a.mnd")\n`,
    });
    const src = host.readFile("/a.mnd");
    if (!src.ok) return;
    const diags = diagnose(src.bytes, { path: "/a.mnd", host });
    expect(diags.some((d) => d.code === "E_IMPORT_CYCLE")).toBe(true);
    expect(diags.find((d) => d.code === "E_IMPORT_CYCLE")!.message).toMatch(
      /a\.mnd.*b\.mnd|b\.mnd.*a\.mnd/,
    );
  });

  test("missing import is diagnosed", () => {
    const host = hostWith({
      "/main.mnd": `(import "./nope.mnd")\n`,
    });
    const src = host.readFile("/main.mnd");
    if (!src.ok) return;
    const diags = diagnose(src.bytes, { path: "/main.mnd", host });
    expect(diags.some((d) => d.code === "E_IMPORT_MISSING")).toBe(true);
  });

  test("extern outside seam modules is an error", () => {
    const host = hostWith({
      "/user.mnd": `(extern mn_foo (x: Int) -> Int)\n`,
    });
    const src = host.readFile("/user.mnd");
    if (!src.ok) return;
    const diags = diagnose(src.bytes, { path: "/user.mnd", host });
    expect(diags.some((d) => d.code === "E_EXTERN_SEAM")).toBe(true);
  });

  test("extern is allowed in seam module path", () => {
    const host = hostWith({
      "/stdlib/io.mnd": `(pub extern write (fd: Int) (s: Str) -> (Result Unit IoError))\n`,
      "/main.mnd": `(import "./stdlib/io.mnd")\n(write 1 "ok")\n`,
    });
    const src = host.readFile("/main.mnd");
    if (!src.ok) return;
    const diags = diagnose(src.bytes, { path: "/main.mnd", host });
    expect(diags).toEqual([]);
    const r = run(src.bytes, { path: "/main.mnd", host });
    expect(r.ok).toBe(true);
    const out = host.stdout.map((b) => new TextDecoder().decode(b)).join("");
    expect(out).toBe("ok");
  });

  test("pub signature must not mention a private nominal type", () => {
    const host = hostWith({
      "/t.mnd": `(variant Hidden (H Int))
(pub defn make (n: Int) -> Hidden (H n))
`,
    });
    const src = host.readFile("/t.mnd");
    if (!src.ok) return;
    const diags = diagnose(src.bytes, { path: "/t.mnd", host });
    expect(diags.some((d) => d.code === "E_PUB_PRIVATE_TYPE")).toBe(true);
  });

  test("prelude loads via import", () => {
    const prelude = new TextDecoder().decode(
      readFileSync(join(import.meta.dir, "../../../prelude/core.mnd")),
    );
    const host = hostWith({
      "/prelude/core.mnd": prelude,
      "/main.mnd": `(import "./prelude/core.mnd")\n(not true)\n`,
    });
    const src = host.readFile("/main.mnd");
    if (!src.ok) return;
    const r = run(src.bytes, { path: "/main.mnd", host });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "bool") expect(r.value.value).toBe(false);
  });
});
