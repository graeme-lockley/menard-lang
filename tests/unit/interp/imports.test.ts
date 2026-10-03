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
    const host = createHost({ fs: createVirtualFs({ "/main.mnd": "(not true)\n" }) });
    const src = host.readFile("/main.mnd");
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    const r = run(src.bytes, { path: "/main.mnd", host });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "bool") expect(r.value.value).toBe(false);
  });

  test("a bare std/list import loads the library", () => {
    const host = createHost({
      fs: createVirtualFs({
        "/main.mnd": "(import std/list)\n(length [1 2 3])\n",
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
          '(import github:acme/ansi@v1/console)\n(import github:acme/ansi@v2/console)\n',
        "/.menard/deps/acme/ansi/v1/console.mnd": "(pub defn hi -> Int 1)\n",
        "/.menard/deps/acme/ansi/v2/console.mnd": "(pub defn hi -> Int 2)\n",
      }),
      env: { HOME: "" },
    });
    const src = host.readFile("/main.mnd");
    if (!src.ok) return;
    const diags = diagnose(src.bytes, { path: "/main.mnd", host });
    expect(diags.some((d) => d.code === "E_IMPORT_VERSION")).toBe(true);
  });
});
