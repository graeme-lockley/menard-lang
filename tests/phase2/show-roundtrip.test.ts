/**
 * LANG-01: every showable spelling re-parses to a value equal to the original.
 * Host path: showValue → run (read + eval) → equalValue.
 */
import { describe, expect, test } from "bun:test";
import { mapNew, mapSet } from "../../host/src/builtins/collections.ts";
import { equalValue, showValue } from "../../host/src/interp/derive.ts";
import { run } from "../../host/src/interp/pipeline.ts";
import {
  vBool,
  vInt,
  vStr,
  vVariant,
  type Value,
} from "../../host/src/interp/value.ts";

const enc = new TextEncoder();

function cons(h: Value, t: Value): Value {
  return vVariant("Cons", [h, t]);
}

function nil(): Value {
  return vVariant("Nil");
}

function roundTrip(v: Value, decls = ""): void {
  const text = showValue(v);
  const r = run(decls + text);
  expect(r.ok, text).toBe(true);
  if (!r.ok) return;
  expect(equalValue(r.value, v), text).toBe(true);
}

describe("show round-trip (LANG-01)", () => {
  test("nullary constructors", () => {
    roundTrip(vVariant("None"));
    roundTrip(nil());
    const decls = "type Color =\n  | Red\n  | Rgb(Int, Int, Int)\n";
    roundTrip(vVariant("Red"), decls);
    const emptyDecls = "type EmptyVar =\n  | Empty\n";
    roundTrip(vVariant("Empty"), emptyDecls);
  });

  test("payload constructors", () => {
    roundTrip(vVariant("Some", [vInt(1n)]));
    roundTrip(vVariant("Ok", [vInt(3n)]));
    roundTrip(vVariant("Err", [vStr(enc.encode("x"))]));
    const decls = "type Color =\n  | Red\n  | Rgb(Int, Int, Int)\n";
    roundTrip(vVariant("Rgb", [vInt(1n), vInt(2n), vInt(3n)]), decls);
  });

  test("records", () => {
    const decls = "record Point {\n  x: Int\n  y: Int\n}\n";
    roundTrip(
      { tag: "record", name: "Point", fields: [vInt(1n), vInt(2n)], fieldNames: ["x", "y"] },
      decls,
    );
  });

  test("lists", () => {
    roundTrip(nil());
    roundTrip(cons(vInt(1n), cons(vInt(2n), cons(vInt(3n), nil()))));
  });

  test("maps", () => {
    roundTrip({ tag: "map", map: mapNew() });
    const m = mapSet(mapNew(), vStr(enc.encode("a")), vInt(1n));
    roundTrip({ tag: "map", map: m });
  });

  test("tuples", () => {
    roundTrip({
      tag: "tuple",
      fields: [vInt(1n), vStr(enc.encode("a")), vBool(true)],
    });
  });

  test("nested values", () => {
    roundTrip(cons(vVariant("Some", [vInt(1n)]), nil()));
    const boxDecls = "record Box[a] {\n  value: a\n}\n";
    roundTrip(
      { tag: "record", name: "Box", fields: [vVariant("None")], fieldNames: ["value"] },
      boxDecls,
    );
    const pointListDecls = "record PointList {\n  x: Int\n  ys: List Int\n}\n";
    roundTrip(
      {
        tag: "record",
        name: "PointList",
        fields: [vInt(1n), cons(vInt(2n), nil())],
        fieldNames: ["x", "ys"],
      },
      pointListDecls,
    );
  });
});
