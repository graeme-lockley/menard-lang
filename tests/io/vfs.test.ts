import { describe, expect, test } from "bun:test";
import { createHost, createVirtualFs } from "../../host/src/host/index.ts";

describe("io hermetic", () => {
  test("write then read", () => {
    const host = createHost({ fs: createVirtualFs() });
    expect(host.writeFile("/x.mnd", new TextEncoder().encode("hi")).ok).toBe(true);
    const r = host.readFile("/x.mnd");
    expect(r.ok).toBe(true);
    if (r.ok) expect(new TextDecoder().decode(r.bytes)).toBe("hi");
  });
});
