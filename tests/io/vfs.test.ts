import { describe, expect, test } from "bun:test";
import {
  createHost,
  createLiveHost,
  createVirtualFs,
} from "../../host/src/host/index.ts";

describe("io hermetic", () => {
  test("write then read", () => {
    const host = createHost({ fs: createVirtualFs() });
    expect(host.writeFile("/x.mnd", new TextEncoder().encode("hi")).ok).toBe(true);
    const r = host.readFile("/x.mnd");
    expect(r.ok).toBe(true);
    if (r.ok) expect(new TextDecoder().decode(r.bytes)).toBe("hi");
  });
});

describe("live host", () => {
  test("writeStdout goes to the sink immediately", () => {
    const chunks: Uint8Array[] = [];
    const host = createLiveHost({
      stdout: {
        write(b) {
          chunks.push(b.slice());
        },
      },
      stderr: { write() {} },
    });
    host.writeStdout(new TextEncoder().encode("hi"));
    expect(new TextDecoder().decode(chunks[0]!)).toBe("hi");
  });
});
