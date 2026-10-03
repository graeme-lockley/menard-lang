import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { diagnose, run } from "../../../host/src/interp/pipeline.ts";
import { createHost, createVirtualFs } from "../../../host/src/host/index.ts";

const lib = `
let sum(...xs: List Int) -> Int =
  match (xs)
    | [] -> 0
    | Cons(h, t) -> h + sum(...t)

let join-more(sep: Str, head: Str, tail: List Str) -> Str =
  match (tail)
    | [] -> head
    | Cons(h, t) -> join-more(sep, str-concat(head, sep, h), t)

let join(sep: Str, ...parts: List Str) -> Str =
  match (parts)
    | [] -> ""
    | Cons(h, t) -> join-more(sep, h, t)
`;

function truth(expr: string): void {
  const r = run(`${lib}\n${expr}`);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value).toEqual({ tag: "bool", value: true });
}

describe("rest parameters", () => {
  test("literals, one element, and the empty call", () => {
    truth("sum(1, 2, 3) == 6");
    truth("sum(4) == 4");
    truth("sum() == 0");
  });

  test("splices a list, with elements before or after it", () => {
    truth("{\n  let xs = [1, 2, 3]\n  sum(...xs) == 6\n}");
    truth("{\n  let xs = [2, 3]\n  sum(1, ...xs) == 6\n}");
    truth("{\n  let xs = [1, 2]\n  sum(...xs, 3) == 6\n}");
    truth("{\n  let xs = [1]\n  let ys = [2, 3]\n  sum(...xs, ...ys) == 6\n}");
  });

  test("a fixed parameter stays in front of the rest", () => {
    truth('join(", ", "a", "b", "c") == "a, b, c"');
    truth('join(", ") == ""');
    truth('{\n  let xs = ["a", "b"]\n  join(":", ...xs) == "a:b"\n}');
    truth('{\n  let xs = ["b"]\n  join("-", "a", ...xs, "c") == "a-b-c"\n}');
  });

  test("an imported rest function packs in the caller", () => {
    const fs = createVirtualFs({
      "/lib.mnd": `pub let sum(...xs: List Int) -> Int =
  match (xs)
    | [] -> 0
    | Cons(h, t) -> h + sum(...t)
`,
    });
    const host = createHost({ fs });
    const r = run(
      `import "/lib.mnd"
{
  let xs = [1]
  let ys = [2, 3]
  sum(...xs, ...ys) == 6
}`,
      { path: "/main.mnd", host },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ tag: "bool", value: true });
  });

  test("negative fixtures report the rest and spread codes", () => {
    const dir = join(import.meta.dir, "../../negative");
    const cases: [string, string, string][] = [
      ["bad-rest-position.mnd", "E_TYPE_REST", "rest parameter must be last"],
      ["bad-rest-type.mnd", "E_TYPE_REST", "rest parameter type must be a List"],
      ["bad-rest-lambda.mnd", "E_TYPE_REST", "`...` is not allowed on a lambda"],
      ["bad-rest-spread.mnd", "E_TYPE_SPREAD", "spread is only valid in a rest-parameter call"],
      ["bad-rest-fixed.mnd", "E_TYPE_SPREAD", "spread in a fixed argument"],
      ["bad-rest-wrap.mnd", "E_TYPE_MISMATCH", "expected Int, found (List Int)"],
    ];
    for (const [file, code, message] of cases) {
      const diags = diagnose(readFileSync(join(dir, file)));
      expect(diags.map((d) => ({ code: d.code, message: d.message }))).toEqual([{ code, message }]);
    }
  });
});
