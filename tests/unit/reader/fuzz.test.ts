import { describe, expect, test } from "bun:test";
import { read, readAll } from "../../../host/src/reader/index.ts";

/** Mulberry32 — deterministic PRNG for reproducible fuzz. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe("fuzz: read never throws", () => {
  test("1000 random byte buffers", () => {
    const rand = mulberry32(0x4d4e5244); // 'MNRD'
    for (let i = 0; i < 1000; i++) {
      const len = (rand() * 64) | 0;
      const buf = new Uint8Array(len);
      for (let j = 0; j < len; j++) {
        buf[j] = (rand() * 256) | 0;
      }
      let result: unknown;
      expect(() => {
        result = read(buf);
      }).not.toThrow();
      expect(result).toBeDefined();
      const r = result as ReturnType<typeof read>;
      expect(typeof r.ok).toBe("boolean");
      if (!r.ok) {
        expect(typeof r.error.message).toBe("string");
        expect(typeof r.error.span.start).toBe("number");
        expect(typeof r.error.span.end).toBe("number");
      }
    }
  });

  test("1000 random buffers via readAll", () => {
    const rand = mulberry32(0x52454144); // 'READ'
    for (let i = 0; i < 1000; i++) {
      const len = (rand() * 96) | 0;
      const buf = new Uint8Array(len);
      for (let j = 0; j < len; j++) {
        buf[j] = (rand() * 256) | 0;
      }
      expect(() => {
        const r = readAll(buf);
        expect(typeof r.ok).toBe("boolean");
      }).not.toThrow();
    }
  });
});
