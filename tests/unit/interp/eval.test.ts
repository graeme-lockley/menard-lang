import { describe, expect, test } from "bun:test";
import { run, diagnose } from "../../../host/src/interp/index.ts";
import { createHost, createVirtualFs } from "../../../host/src/host/index.ts";
import { formatDiagnostics } from "../../../host/src/diagnostic/index.ts";
import {
  mapNew,
  mapSet,
  mapGet,
  mapKeys,
  mapSize,
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

  test("map-keys is sorted by key order", () => {
    const enc = new TextEncoder();
    let m = mapNew();
    m = mapSet(m, { tag: "str", bytes: enc.encode("c") }, { tag: "int", value: 3n });
    m = mapSet(m, { tag: "str", bytes: enc.encode("a") }, { tag: "int", value: 1n });
    m = mapSet(m, { tag: "str", bytes: enc.encode("b") }, { tag: "int", value: 2n });
    const keys = mapKeys(m).map((k) =>
      k.tag === "str" ? new TextDecoder().decode(k.bytes) : "",
    );
    expect(keys).toEqual(["a", "b", "c"]);
  });

  test("map-set is O(log n): 100k inserts within budget", () => {
    const N = 100_000;
    const budgetMs = 3000;
    let m = mapNew();
    const empty = m;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      m = mapSet(m, { tag: "int", value: BigInt(i) }, { tag: "int", value: BigInt(i) });
    }
    const elapsed = performance.now() - t0;
    expect(mapSize(m)).toBe(BigInt(N));
    expect(mapSize(empty)).toBe(0n);
    expect(mapGet(empty, { tag: "int", value: 0n })).toBeUndefined();
    expect(mapGet(m, { tag: "int", value: 0n })).toEqual({ tag: "int", value: 0n });
    expect(mapGet(m, { tag: "int", value: BigInt(N - 1) })).toEqual({
      tag: "int",
      value: BigInt(N - 1),
    });
    expect(elapsed).toBeLessThan(budgetMs);
  }, 10_000);
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

describe("evaluator depth", () => {
  test("non-tail recursion of 20k frames stays within memory", () => {
    const src = `(defn mk (n: Int) -> Int (if (= n 0) 0 (+ 1 (mk (- n 1)))))
(mk 20000)`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(20000n);
  }, 60_000);

  test("builds and sizes a 10k-element list", () => {
    const src = `(defn mk (n: Int) -> (List Int) (if (= n 0) (Nil) (Cons n (mk (- n 1)))))
(defn (size [a]) (xs: (List a)) -> Int (match xs (Nil) 0 (Cons _ t) (+ 1 (size t))))
(size (mk 10000))`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(10000n);
  }, 120_000);
});

describe("intrinsics via run", () => {
  test("show int", () => {
    const r = run('(show 42)');
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "str") {
      expect(new TextDecoder().decode(r.value.bytes)).toBe("42");
    }
  });

  test("print writes Str bare, no newline", () => {
    const host = createHost();
    const r = run('(print "hi")', { host });
    expect(r.ok).toBe(true);
    const out = host.stdout.map((b) => new TextDecoder().decode(b)).join("");
    expect(out).toBe("hi");
  });

  test("println appends newline", () => {
    const host = createHost();
    const r = run('(println "hi")', { host });
    expect(r.ok).toBe(true);
    const out = host.stdout.map((b) => new TextDecoder().decode(b)).join("");
    expect(out).toBe("hi\n");
  });

  test("print zero args writes nothing; println writes newline", () => {
    const h1 = createHost();
    expect(run("(print)", { host: h1 }).ok).toBe(true);
    expect(h1.stdout).toEqual([]);
    const h2 = createHost();
    expect(run("(println)", { host: h2 }).ok).toBe(true);
    expect(new TextDecoder().decode(h2.stdout[0]!)).toBe("\n");
  });

  test("print mixes Str raw and show of Int", () => {
    const host = createHost();
    const r = run('(print "a" 1)', { host });
    expect(r.ok).toBe(true);
    const out = host.stdout.map((b) => new TextDecoder().decode(b)).join("");
    expect(out).toBe("a1");
  });

  test("show still quotes Str", () => {
    const r = run('(show "hi")');
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "str") {
      expect(new TextDecoder().decode(r.value.bytes)).toBe('"hi"');
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
