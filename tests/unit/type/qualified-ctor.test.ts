import { describe, expect, test } from "bun:test";
import { createLiveHost } from "../../../host/src/host/index.ts";
import { run } from "../../../host/src/interp/pipeline.ts";
import { diagnose } from "../../../host/src/interp/pipeline.ts";

const source = (body: string) =>
  new TextEncoder().encode(`import std/json as Json

let main() -> Int {
${body}
  0
}
`);

describe("aliased imports and constructors", () => {
  test("qualified constructors typecheck and evaluate", () => {
    const chunks: Uint8Array[] = [];
    const host = createLiveHost({
      realFs: true,
      argv: [],
      stdout: { write: (b) => chunks.push(b) },
    });
    const r = run(source("  println(show(Json.JsonFloat(1.5)))"), {
      path: "tests/unit/type/qualified-ctor.mnd",
      host,
    });
    expect(r.ok).toBe(true);
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("(JsonFloat 1.5)\n");
  });

  test("constructors are not in unqualified scope", () => {
    const host = createLiveHost({ realFs: true, argv: [] });
    const diags = diagnose(source("  println(show(JsonFloat(1.5)))"), {
      path: "tests/unit/type/unqualified-ctor.mnd",
      host,
    });
    expect(diags.some((d) => d.code === "E_TYPE_UNBOUND")).toBe(true);
  });
});
