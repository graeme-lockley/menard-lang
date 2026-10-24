import { describe, expect, test } from "bun:test";
import { createLiveHost } from "../../../host/src/host/index.ts";
import { run } from "../../../host/src/interp/pipeline.ts";

describe("aliased imports and constructors", () => {
  test("an aliased constructor is in scope and evaluates", () => {
    const source = new TextEncoder().encode(`import std/json as Json

let main() -> Int {
  println(show(JsonFloat(1.5)))
  0
}
`);
    const chunks: Uint8Array[] = [];
    const host = createLiveHost({
      realFs: true,
      argv: [],
      stdout: { write: (b) => chunks.push(b) },
    });
    const r = run(source, { path: "tests/unit/type/qualified-ctor.mnd", host });
    expect(r.ok).toBe(true);
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("(JsonFloat 1.5)\n");
  });
});
