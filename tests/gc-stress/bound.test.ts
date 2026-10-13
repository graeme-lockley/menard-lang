/**
 * The churn program's live set stays bounded. Retained bytes on a major
 * collection are `size - freed`. Reserved old space may grow; that is
 * not a leak. The cap is the measured high water of one iteration's
 * live data, with headroom.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const fixture = "tests/gc-stress/churn.mnd";
/** Measured high water on a correct run is 393312 bytes. The cap leaves
 *  room for one iteration's live data and fails if a second store is retained. */
const RETAINED_CAP = 512 * 1024;

describe.skipIf(!Bun.which("clang"))("gc stress live set", () => {
  test("major collections retain a bounded live set", () => {
    const dir = mkdtempSync(join(tmpdir(), "menard-gc-stress-"));
    const binary = join(dir, "churn");
    const trace = join(dir, "gc-trace.log");
    try {
      const built = spawnSync(process.execPath, [
        "run", "host/src/cli/menard.ts", "run", "src/mn.mnd", "--",
        "build", fixture, "-o", binary, "--clean",
      ], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
      if (built.error) throw built.error;
      expect(built.status).toBe(0);
      expect(built.stderr).not.toContain("error");

      const native = spawnSync(binary, [], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          MENARD_HEAP_VERIFY: "1",
          MENARD_GC_TRACE: "1",
          MENARD_GC_TRACE_OUT: trace,
        },
      });
      if (native.error) throw native.error;
      expect(native.stderr).toBe("");
      expect(native.status).toBe(0);
      expect(native.stdout).toBe("2621900\n");

      const text = readFileSync(trace, "utf8");
      const majors: { size: number; freed: number }[] = [];
      for (const line of text.split("\n")) {
        if (!line.startsWith("gc major ")) continue;
        const size = Number(line.match(/size=(\d+)/)?.[1]);
        const freed = Number(line.match(/freed=(\d+)/)?.[1]);
        expect(Number.isFinite(size)).toBe(true);
        expect(Number.isFinite(freed)).toBe(true);
        expect(freed).toBeLessThanOrEqual(size);
        majors.push({ size, freed });
      }
      expect(majors.length).toBeGreaterThanOrEqual(2);
      for (const m of majors) {
        expect(m.size - m.freed).toBeLessThanOrEqual(RETAINED_CAP);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
