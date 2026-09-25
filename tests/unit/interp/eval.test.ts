import { describe, expect, test } from "bun:test";
import { run, diagnose } from "../../../host/src/interp/index.ts";
import { createHost, createVirtualFs } from "../../../host/src/host/index.ts";
import { formatDiagnostics } from "../../../host/src/diagnostic/index.ts";
import {
  mapNew,
  mapSet,
  mapGet,
  sbNew,
  sbAppend,
  sbToStr,
  sbTakeStr,
} from "../../../host/src/builtins/index.ts";

describe("builtins Map", () => {
  test("persistent: set does not alias", () => {
    const m0 = mapNew();
    const m1 = mapSet(m0, { tag: "str", bytes: new TextEncoder().encode("k") }, { tag: "int", value: 1n });
    expect(mapGet(m0, { tag: "str", bytes: new TextEncoder().encode("k") })).toBeUndefined();
    expect(mapGet(m1, { tag: "str", bytes: new TextEncoder().encode("k") })).toEqual({
      tag: "int",
      value: 1n,
    });
  });
});

describe("builtins StringBuffer", () => {
  test("copy-on-write after to-str", () => {
    const sb = sbNew();
    sbAppend(sb, new TextEncoder().encode("hi"));
    const s1 = sbToStr(sb).slice();
    sbAppend(sb, new TextEncoder().encode("!"));
    expect(new TextDecoder().decode(s1)).toBe("hi");
    expect(new TextDecoder().decode(sbToStr(sb))).toBe("hi!");
  });

  test("take-str transfers storage", () => {
    const sb = sbNew();
    sbAppend(sb, new TextEncoder().encode("ab"));
    const s = sbTakeStr(sb);
    expect(new TextDecoder().decode(s)).toBe("ab");
    expect(sb.length).toBe(0);
  });
});

describe("intrinsics via run", () => {
  test("show int", () => {
    const r = run('(show 42)');
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "str") {
      expect(new TextDecoder().decode(r.value.bytes)).toBe("42");
    }
  });

  test("map round trip", () => {
    const src = `(do
  (let m (map-new))
  (let m2 (map-set m "a" 1))
  (map-get m2 "a"))`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "variant") {
      expect(r.value.ctor).toBe("Some");
    }
  });
});

describe("virtual fs", () => {
  test("list-dir is sorted", () => {
    const fs = createVirtualFs({
      "/b.txt": "b",
      "/a.txt": "a",
      "/c.txt": "c",
    });
    const host = createHost({ fs });
    const listed = host.listDir("/");
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.names).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  test("read missing file", () => {
    const host = createHost();
    const r = host.readFile("/nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.tag).toBe("NotFound");
  });
});

describe("negative fixtures (formatted)", () => {
  test("type error golden shape", () => {
    const src = "(+ 1 true)";
    const diags = diagnose(src);
    expect(diags.length).toBeGreaterThan(0);
    const text = formatDiagnostics(diags, src, "neg.mnd");
    expect(text).toMatch(/neg\.mnd:\d+:\d+: error\[E_TYPE_/);
    expect(text).toContain("|");
    expect(text).toContain("^");
  });
});
