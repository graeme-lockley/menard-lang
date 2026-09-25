/**
 * Build-host benchmark (spec §3.7 / #10).
 * Compiler-shaped workloads with time budgets so asymptotic or dispatch
 * regressions fail CI rather than a bootstrap.
 */
import { describe, expect, test } from "bun:test";
import { run } from "../../host/src/interp/pipeline.ts";
import { createHost, createVirtualFs } from "../../host/src/host/index.ts";
import { mapNew, mapSet, mapGet, mapSize } from "../../host/src/builtins/collections.ts";
import { sbNew, sbAppend, sbToStr } from "../../host/src/builtins/collections.ts";

function timed(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe("build-host bench", () => {
  test("deep non-tail recursion ≥ 100k frames", () => {
    const src = `(defn mk (n: Int) -> Int (if (= n 0) 0 (+ 1 (mk (- n 1)))))
(mk 100000)`;
    const ms = timed(() => {
      const r = run(src);
      expect(r.ok).toBe(true);
      if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(100000n);
    });
    expect(ms).toBeLessThan(5000);
  }, 30_000);

  test("loop/recur walks 100k steps", () => {
    const src = `(defn sum-to (n: Int) -> Int
  (loop ((i 0) (acc 0))
    (if (> i n) acc (recur (+ i 1) (+ acc i)))))
(sum-to 100000)`;
    const ms = timed(() => {
      const r = run(src);
      expect(r.ok).toBe(true);
    });
    expect(ms).toBeLessThan(3000);
  }, 15_000);

  test("Map ≥ 100k inserts and lookups", () => {
    const ms = timed(() => {
      let m = mapNew();
      for (let i = 0; i < 100_000; i++) {
        m = mapSet(m, { tag: "int", value: BigInt(i) }, { tag: "int", value: BigInt(i) });
      }
      expect(mapSize(m)).toBe(100000n);
      expect(mapGet(m, { tag: "int", value: 50000n })).toEqual({
        tag: "int",
        value: 50000n,
      });
    });
    expect(ms).toBeLessThan(3000);
  }, 15_000);

  test("StringBuffer heavy appends", () => {
    const chunk = new TextEncoder().encode("abcdefghij");
    const ms = timed(() => {
      const sb = sbNew();
      for (let i = 0; i < 50_000; i++) sbAppend(sb, chunk);
      const s = sbToStr(sb);
      expect(s.length).toBe(500_000);
    });
    expect(ms).toBeLessThan(2000);
  }, 10_000);

  test("multi-module file read/write via Host", () => {
    const host = createHost({
      fs: createVirtualFs({
        "/lib.mnd": `(pub defn twice (n: Int) -> Int (* n 2))\n`,
        "/main.mnd": `(import "./lib.mnd")
(let data (read-file "/in.txt"))
(match data
  (Ok s) (do (write-file "/out.txt" s) (twice 21))
  (Err _) 0)
`,
        "/in.txt": "payload",
      }),
    });
    const src = host.readFile("/main.mnd");
    expect(src.ok).toBe(true);
    if (!src.ok) return;
    const ms = timed(() => {
      for (let i = 0; i < 100; i++) {
        const r = run(src.bytes, { path: "/main.mnd", host });
        expect(r.ok).toBe(true);
        if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(42n);
      }
    });
    expect(ms).toBeLessThan(5000);
  }, 20_000);

  test("while 1M iterations within build-host floor", () => {
    const src = `(defn run (n: Int) -> Int
  (let i (ref 0))
  (let acc (ref 0))
  (while (< (deref i) n)
    (set! acc (+ (deref acc) (deref i)))
    (set! i (+ (deref i) 1)))
  (deref acc))
(run 1000000)`;
    const ms = timed(() => {
      const r = run(src);
      expect(r.ok).toBe(true);
    });
    // Baseline at filing was ~2.7s; post resolve-dispatch ~1.6–2s. Keep CI headroom.
    expect(ms).toBeLessThan(8_000);
  }, 30_000);
});
