import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("SECURITY.md (OTH-05)", () => {
  test("states supported versions, disclosure, threat model, and out of scope", () => {
    const text = read("SECURITY.md");
    expect(text).toMatch(/##\s+Supported versions/i);
    expect(text).toMatch(/##\s+Reporting a vulnerability|##\s+Disclosure/i);
    expect(text).toMatch(/##\s+Threat model/i);
    expect(text).toMatch(/##\s+Out of scope/i);
    expect(text).toMatch(/GitHub.*private.*vulnerabilit|private vulnerability reporting/i);
    expect(text).toMatch(/memory safety/i);
    expect(text).toMatch(/C\/FFI|FFI.*trusted|trusted.*C/i);
    expect(text).toMatch(/OpenSSL/);
    expect(text).toMatch(/checksum/i);
    expect(text).toMatch(/no network at compile|offline.*compile|compile.*no network/i);
    expect(text).toMatch(/enforced by OTH-04|OTH-04.*enforcement|enforcement.*OTH-04/i);
    expect(text).toMatch(/github:.*cache-miss|cache miss.*fetch|acknowledged gap/i);
    expect(text).toContain("docs/security.md");
  });
});

describe("docs/security.md unsafe boundary (OTH-05)", () => {
  test("documents pointer lifetimes, Str bytes, ownership, no-shell-string, TLS, HTTP, native-only", () => {
    const text = read("docs/security.md");
    expect(text).toMatch(/##\s+Unsafe boundary/i);
    expect(text).toMatch(/pointer lifetime|Pointer lifetime/i);
    expect(text).toMatch(/copy into `?Str`|copy into Menard `?Str`/i);
    expect(text).toMatch(/free.*C buffer|C buffers?.*free/i);
    expect(text).toMatch(/no long-term|long-term.*alias|heap alias/i);
    expect(text).toMatch(/`?Str`.*byte|arbitrary bytes|NULs?/i);
    expect(text).toMatch(/buffer ownership|Buffer ownership/i);
    expect(text).toMatch(/no-shell-string|no shell string|shell string/i);
    expect(text).toMatch(/Proc\.spawn|std\/proc|argv/i);
    expect(text).toMatch(/##\s+TLS policy/i);
    expect(text).toMatch(/##\s+HTTP DoS model/i);
    expect(text).toMatch(/native-only|interpreter.*Unsupported|Err\(Unsupported\)/i);
    expect(text).toContain("SECURITY.md");
  });

  test("TLS policy: verify, hostname, SNI, system trust, insecure opt-out", () => {
    const text = read("docs/security.md");
    expect(text).toMatch(/peer.*verif|SSL_VERIFY_PEER|verifies the peer/i);
    expect(text).toMatch(/hostname/i);
    // Must name the API the runtime calls (not SSL_set1_host).
    expect(text).toContain("X509_VERIFY_PARAM_set1_host");
    expect(text).toMatch(/\bSNI\b/);
    expect(text).toMatch(/system trust store/i);
    expect(text).toMatch(/insecure|tls-client-insecure/i);
    expect(text).toMatch(/opt-out|development only/i);
  });

  test("HTTP policy: caps, last-wins, deadlines, DoS model", () => {
    const text = read("docs/security.md");
    expect(text).toContain("8 KiB");
    expect(text).toContain("64 KiB");
    expect(text).toContain("8 MiB");
    expect(text).toMatch(/last-wins/i);
    expect(text).toMatch(/deadline/i);
    expect(text).toMatch(/DoS/i);
  });
});

describe("spec seam list (OTH-05 / DOC-02)", () => {
  test("§2.7 confinement lists sched and net with the other seam modules", () => {
    const text = read("docs/menard-spec.md");
    const section = text.slice(text.indexOf("### 2.7 Modules"));
    const confinement = section.slice(0, section.indexOf("### 2.8"));
    expect(confinement).toMatch(/sched\.mnd/);
    expect(confinement).toMatch(/net\.mnd/);
    expect(confinement).toMatch(/sys\.mnd/);
    expect(confinement).toMatch(/io\.mnd/);
    expect(confinement).toMatch(/fs\.mnd/);
    expect(confinement).toMatch(/proc\.mnd/);
    expect(confinement).toMatch(/time\.mnd/);
  });
});

describe("FFI proving ground (OTH-05)", () => {
  test("SQLite README and ffi.md note proving ground and C-library safety", () => {
    const readme = read("examples/ffi/sqlite/README.md");
    const ffi = read("docs/design/ffi.md");
    expect(readme).toMatch(/proving ground/i);
    expect(readme).toMatch(/libsqlite3|C library/i);
    expect(readme).toMatch(/memory-safe|Menard GC|safety/i);
    expect(ffi).toMatch(/proving ground/i);
    expect(ffi).toMatch(/libsqlite3|C library/i);
    expect(ffi).toMatch(/memory-safe|Menard GC does not|own safety/i);
    expect(ffi).toMatch(/sql_open/);
    expect(ffi).toMatch(/sql_close/);
    expect(ffi).toMatch(/sql_exec/);
    expect(ffi).toMatch(/sql_query/);
    expect(ffi).toMatch(/sql_errmsg/);
    expect(ffi).toMatch(/sched/);
    expect(ffi).toMatch(/\bnet\b/);
  });
});

describe("README security link (OTH-05)", () => {
  test("README.md links SECURITY.md", () => {
    const text = read("README.md");
    expect(text).toMatch(/\[.*\]\(SECURITY\.md\)/);
  });

  test("docs/README.md links security.md", () => {
    const text = read("docs/README.md");
    expect(text).toMatch(/\[.*\]\(security\.md\)/);
  });
});
