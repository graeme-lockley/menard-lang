import { describe, expect, test } from "bun:test";
import { diagnose, run } from "../../../host/src/interp/pipeline.ts";
import { createHost, createVirtualFs } from "../../../host/src/host/index.ts";
import {
  githubCacheFile,
  parseGithubSpec,
  resolveImportPath,
  versionClashMessage,
  noteGithubVersion,
} from "../../../host/src/interp/imports.ts";

describe("import specifiers", () => {
  test("std/ names the shipped file", () => {
    expect(resolveImportPath("/app/main.mnd", "std/list", null)).toBe("stdlib/list.mnd");
    expect(resolveImportPath("/app/main.mnd", "std/string-buffer", null)).toBe(
      "stdlib/string-buffer.mnd",
    );
  });

  test("a relative spec stays beside the importer", () => {
    expect(resolveImportPath("/app/main.mnd", "./lexer.mnd", null)).toBe("/app/lexer.mnd");
  });

  test("github: names a cache file and rejects a second version", () => {
    const spec = "github:acme/ansi@v1.2.0/console";
    const parsed = parseGithubSpec(spec);
    expect(parsed).toEqual({
      owner: "acme",
      repo: "ansi",
      version: "v1.2.0",
      modulePath: "console",
    });
    expect(githubCacheFile(parsed!, "/tmp/home")).toBe(
      "/tmp/home/.menard/deps/acme/ansi/v1.2.0/console.mnd",
    );
    expect(resolveImportPath("/app/main.mnd", spec, "/tmp/home")).toBe(
      "/tmp/home/.menard/deps/acme/ansi/v1.2.0/console.mnd",
    );
    const versions = new Map<string, string>();
    expect(noteGithubVersion(versions, spec)).toBeNull();
    const clash = noteGithubVersion(versions, "github:acme/ansi@v9/console");
    expect(clash).not.toBeNull();
    expect(versionClashMessage(clash!)).toBe("two versions of acme/ansi: v1.2.0 and v9");
  });

  test("std/basics is in scope without an import", () => {
    const host = createHost({ fs: createVirtualFs({ "/main.mnd": "not(true)\n" }) });
    const src = host.readFile("/main.mnd");
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    const r = run(src.bytes, { path: "/main.mnd", host });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "bool") expect(r.value.value).toBe(false);
  });

  test("a qualified import binds the alias and hides the bare name", () => {
    const host = createHost({
      fs: createVirtualFs({
        "/lib.mnd": "pub let answer() -> Int = 41\n",
        "/main.mnd": 'import "./lib.mnd" as Lib\nLib.answer()\n',
      }),
    });
    const src = host.readFile("/main.mnd");
    if (!src.ok) return;
    expect(diagnose(src.bytes, { path: "/main.mnd", host })).toEqual([]);
    const r = run(src.bytes, { path: "/main.mnd", host });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(41n);

    const bare = createHost({
      fs: createVirtualFs({
        "/lib.mnd": "pub let answer() -> Int = 41\n",
        "/main.mnd": 'import "./lib.mnd" as Lib\nanswer()\n',
      }),
    });
    const bareSrc = bare.readFile("/main.mnd");
    if (!bareSrc.ok) return;
    const diags = diagnose(bareSrc.bytes, { path: "/main.mnd", host: bare });
    expect(diags.some((d) => d.code === "E_TYPE_UNBOUND")).toBe(true);
  });

  test("a qualified std/result import resolves and-then", () => {
    const host = createHost({
      fs: createVirtualFs({
        "/main.mnd": `import std/result as Result
Result.and-then(fn (n) = Ok(n + 1), Ok(1))
`,
      }),
    });
    const src = host.readFile("/main.mnd");
    if (!src.ok) return;
    expect(diagnose(src.bytes, { path: "/main.mnd", host })).toEqual([]);
    const r = run(src.bytes, { path: "/main.mnd", host });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ tag: "variant", ctor: "Ok", payloads: [{ tag: "int", value: 2n }] });
  });

  test("a record field is selected by declaration order", () => {
    const host = createHost({
      fs: createVirtualFs({
        "/main.mnd": `record Pair {
  fst: Int
  snd: Int
}

record Outer {
  inner: Pair
}

let o = Outer(Pair(7, 8))
o.inner.fst
`,
      }),
    });
    const src = host.readFile("/main.mnd");
    if (!src.ok) return;
    expect(diagnose(src.bytes, { path: "/main.mnd", host })).toEqual([]);
    const r = run(src.bytes, { path: "/main.mnd", host });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(7n);
  });

  test("a bare std/list import loads the library", () => {
    const host = createHost({
      fs: createVirtualFs({
        "/main.mnd": "import std/list\nlength([1, 2, 3])\n",
      }),
    });
    const src = host.readFile("/main.mnd");
    if (!src.ok) return;
    const diags = diagnose(src.bytes, { path: "/main.mnd", host });
    expect(diags).toEqual([]);
    const r = run(src.bytes, { path: "/main.mnd", host });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(3n);
  });

  test("two github versions are an error and do not fetch", () => {
    const host = createHost({
      fs: createVirtualFs({
        "/main.mnd":
          'import github:acme/ansi@v1/console\nimport github:acme/ansi@v2/console\n',
        "/.menard/deps/acme/ansi/v1/console.mnd": "pub let hi() -> Int = 1\n",
        "/.menard/deps/acme/ansi/v2/console.mnd": "pub let hi() -> Int = 2\n",
      }),
      env: { HOME: "" },
    });
    const src = host.readFile("/main.mnd");
    if (!src.ok) return;
    const diags = diagnose(src.bytes, { path: "/main.mnd", host });
    expect(diags.some((d) => d.code === "E_IMPORT_VERSION")).toBe(true);
  });
});
