import { describe, expect, test } from "bun:test";
import {
  fixNullaryCtor,
  rewriteNullaryCallsText,
  collectNullaryNames,
  BUILTIN_NULLARIES,
} from "../../../host/src/fix/nullary-ctor.ts";
import { parseProgram } from "../../../host/src/reader/parse.ts";

describe("nullary-ctor fix", () => {
  test("rewrites None() and user nullaries in expressions", () => {
    const src = `type Color =
  | Red
  | Blue

let x = None()
let ys = [Red(), Blue()]
let z = Some(1)
`;
    const r = fixNullaryCtor(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.source).toContain("let x = None\n");
    expect(r.source).toContain("[Red, Blue]");
    expect(r.source).toContain("Some(1)");
    expect(r.source).not.toContain("None()");
    expect(r.source).not.toContain("Red()");
  });

  test("is idempotent", () => {
    const src = `let x = None()\n`;
    const once = fixNullaryCtor(src);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = fixNullaryCtor(once.source);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(twice.changed).toBe(false);
    expect(twice.source).toBe(once.source);
  });

  test("does not rewrite payload constructors or zero-arg functions", () => {
    const src = `let a = Some(1)
let b = Map.empty()
let c = Err()
`;
    const r = fixNullaryCtor(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toContain("Some(1)");
    expect(r.source).toContain("Map.empty()");
    expect(r.source).toContain("Err()");
  });

  test("does not rewrite bare match patterns", () => {
    const src = `let f(m: Maybe Int) -> Int =
  match (m)
    | None -> 0
    | Some(n) -> n
`;
    const r = fixNullaryCtor(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(false);
    expect(r.source).toBe(src);
  });

  test("does not touch pattern Permanent() (hand migration)", () => {
    const src = `type Policy =
  | Permanent
  | Temporary

let f(p: Policy) -> Bool =
  match (p)
    | Permanent() -> true
    | Temporary() -> false
`;
    const r = fixNullaryCtor(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Pattern slots are skipped; Permanent() in the arm stays.
    expect(r.source).toContain("| Permanent() ->");
    expect(r.source).toContain("| Temporary() ->");
  });

  test("collectNullaryNames finds local variants and builtins", () => {
    const src = `type Color =
  | Red
  | Blue(Int)
`;
    const parsed = parseProgram(new TextEncoder().encode(src));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const names = collectNullaryNames(parsed.forms);
    expect(names.has("Red")).toBe(true);
    expect(names.has("Blue")).toBe(false);
    expect(names.has("None")).toBe(true);
    for (const n of BUILTIN_NULLARIES) expect(names.has(n)).toBe(true);
  });

  test("text rewrite migrates pattern call forms too", () => {
    const names = new Set(["Permanent", "Temporary", "None"]);
    const src = `match (p)
  | Permanent() -> true
  | Temporary() -> false
let x = None()
`;
    const out = rewriteNullaryCallsText(src, names);
    expect(out).toContain("| Permanent ->");
    expect(out).toContain("| Temporary ->");
    expect(out).toContain("let x = None\n");
  });
});
