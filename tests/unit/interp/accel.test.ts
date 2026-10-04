import { describe, expect, test } from "bun:test";
import { mapNew, mapSet, sbNew, sbToStr } from "../../../host/src/builtins/collections.ts";
import { runAccel, type Accel } from "../../../host/src/interp/accel.ts";
import { vInt, type Value } from "../../../host/src/interp/value.ts";

function sink(): { sb: ReturnType<typeof sbNew>; value: Value } {
  const sb = sbNew();
  return {
    sb,
    value: {
      tag: "record",
      name: "BitSink",
      fields: [
        { tag: "sb", sb },
        { tag: "ref", cell: { value: vInt(0n) } },
        { tag: "ref", cell: { value: vInt(0n) } },
      ],
    },
  };
}

const writeFixed: Accel = { kind: "host", id: "bitsink-write-fixed", impure: true };
const lineSearch: Accel = { kind: "host", id: "line-search", impure: false };

describe("stage0 shortcuts", () => {
  test("bitsink-write-fixed packs low bits then flushes a byte", () => {
    const s = sink();
    expect(runAccel(writeFixed, [s.value, vInt(1n), vInt(2n)])).toEqual({ tag: "unit" });
    expect(runAccel(writeFixed, [s.value, vInt(3n), vInt(6n)])).toEqual({ tag: "unit" });
    expect(Array.from(sbToStr(s.sb))).toEqual([13]);
  });

  test("line-search counts starts at or before the offset", () => {
    let m = mapNew();
    m = mapSet(m, vInt(0n), vInt(0n));
    m = mapSet(m, vInt(1n), vInt(10n));
    m = mapSet(m, vInt(2n), vInt(20n));
    const map: Value = { tag: "map", map: m };
    expect(runAccel(lineSearch, [map, vInt(0n), vInt(3n), vInt(0n)])).toEqual(vInt(1n));
    expect(runAccel(lineSearch, [map, vInt(0n), vInt(3n), vInt(10n)])).toEqual(vInt(2n));
    expect(runAccel(lineSearch, [map, vInt(0n), vInt(3n), vInt(19n)])).toEqual(vInt(2n));
    expect(runAccel(lineSearch, [map, vInt(0n), vInt(3n), vInt(20n)])).toEqual(vInt(3n));
  });
});
