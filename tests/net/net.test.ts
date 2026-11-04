/**
 * Build F — native parkable TCP/TLS; interpreter returns Err(Unsupported) (CONC-10).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const CERTS = join(ROOT, "tests/net/certs");

function runNative(
  fixture: string,
  env: NodeJS.ProcessEnv = {},
): { status: number | null; stdout: string; stderr: string; signal: NodeJS.Signals | null } {
  const dir = mkdtempSync(join(tmpdir(), "menard-net-"));
  const binary = join(dir, "out");
  try {
    const built = spawnSync(
      process.execPath,
      [
        "run",
        "host/src/cli/menard.ts",
        "run",
        "src/mn.mnd",
        "--",
        "build",
        fixture,
        "-o",
        binary,
        "--clean",
      ],
      { cwd: ROOT, encoding: "utf8", timeout: 180_000 },
    );
    if (built.status !== 0) {
      return {
        status: built.status,
        stdout: built.stdout,
        stderr: built.stderr,
        signal: built.signal,
      };
    }
    const native = spawnSync(binary, [], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, ...env },
    });
    return {
      status: native.status,
      stdout: native.stdout ?? "",
      stderr: native.stderr ?? "",
      signal: native.signal,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runInter(fixture: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(
    process.execPath,
    ["run", "host/src/cli/menard.ts", "run", fixture],
    { cwd: ROOT, encoding: "utf8", timeout: 30_000 },
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("Build F net", () => {
  test("native: TCP echo", () => {
    const r = runNative("tests/net/echo.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ping");
  });

  test("inter: TCP echo returns Unsupported (CONC-10)", () => {
    const r = runInter("tests/net/echo.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.stderr).not.toContain("unbound");
    expect(r.stdout).toContain("Unsupported");
    expect(r.status).not.toBe(0);
  });

  test.skipIf(!Bun.which("clang"))("native: Net timeouts (CONC-02)", () => {
    const r = runNative("tests/net/timeouts.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("1\n2\n3\n");
  }, { timeout: 180_000 });

  test.skipIf(!Bun.which("clang"))("native: TLS verify + SNI (CONC-03)", () => {
    const r = runNative("tests/net/tls-verify.mnd", {
      MENARD_TLS_CA_FILE: join(CERTS, "ca.crt"),
      MENARD_TLS_SNI_NAME: "a.menard.test",
      MENARD_TLS_SNI_CERT: join(CERTS, "sni-a.crt"),
      MENARD_TLS_SNI_KEY: join(CERTS, "sni-a.key"),
    });
    expect(r.signal).toBeNull();
    expect(r.stderr).not.toContain("panic");
    expect(r.stderr).not.toContain("error:");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("1\n2\n3\n4\n5\n");
  }, { timeout: 180_000 });

  test.skipIf(!Bun.which("clang"))("native: TLS rejects untrusted peer (CONC-03)", () => {
    const r = runNative("tests/net/tls-reject.mnd", {
      MENARD_TLS_CA_FILE: "",
    });
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("rejected");
  }, { timeout: 180_000 });

  test.skipIf(!Bun.which("clang"))("native: TLS handshake parks (CONC-03)", () => {
    const r = runNative("tests/net/tls-stall.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("live");
  }, { timeout: 180_000 });

  test.skipIf(!Bun.which("clang"))("native: TLS failure classification (CONC-19)", () => {
    const r = runNative("tests/net/tls-classify.mnd", {
      MENARD_TLS_CA_FILE: join(CERTS, "ca.crt"),
    });
    expect(r.signal).toBeNull();
    expect(r.stderr).not.toContain("panic");
    expect(r.stderr).not.toContain("error:");
    expect(r.stdout).not.toContain("error:");
    expect(r.stdout).not.toContain("panic");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("1\n2\n3\n4\n");
  }, { timeout: 180_000 });

  test("inter: TLS module loads; net returns Unsupported (CONC-10)", () => {
    const r = runInter("tests/net/tls-reject.mnd");
    expect(r.stderr).not.toContain("panic");
    expect(r.stderr).not.toContain("unbound");
    expect(r.stdout).toContain("Unsupported");
    expect(r.status).not.toBe(0);
  });
});
