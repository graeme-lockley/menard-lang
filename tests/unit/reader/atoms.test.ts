import { describe, expect, test } from "bun:test";
import { read, print, astEqual } from "../../../host/src/reader/index.ts";

function mustRead(src: string | Uint8Array) {
  const r = read(src);
  if (!r.ok) throw new Error(`parse failed: ${r.error.message} @ ${r.error.span.start}`);
  return r.ast;
}

describe("symbols and ! hygiene", () => {
  test("reads identifiers", () => {
    const a = mustRead("parse-expr");
    expect(a.tag).toBe("sym");
    if (a.tag === "sym") {
      expect(new TextDecoder().decode(a.name)).toBe("parse-expr");
    }
  });

  test("trailing ! is allowed", () => {
    const a = mustRead("set!");
    expect(a.tag).toBe("sym");
    const b = mustRead("sb-append!");
    expect(b.tag).toBe("sym");
  });

  test("! only as final character", () => {
    const r = read("a!b");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("'!' may appear only as the final character");
    }
  });

  test("field name with trailing colon", () => {
    const a = mustRead("fst:");
    expect(a.tag).toBe("sym");
    if (a.tag === "sym") {
      expect(new TextDecoder().decode(a.name)).toBe("fst:");
    }
  });

  test("-> is a symbol", () => {
    const a = mustRead("->");
    expect(a.tag).toBe("sym");
  });

  test("round-trip symbols", () => {
    for (const s of ["x", "map", "set!", "sb-append!", "fst:", "->", "<", "="]) {
      const a = mustRead(s);
      const b = mustRead(print(a));
      expect(astEqual(a, b)).toBe(true);
    }
  });
});

describe("integers", () => {
  test("decimal ints as bigint", () => {
    const a = mustRead("42");
    expect(a.tag).toBe("int");
    if (a.tag === "int") {
      expect(a.value).toBe(42n);
      expect(typeof a.value).toBe("bigint");
    }
  });

  test("negative ints", () => {
    const a = mustRead("-7");
    expect(a.tag).toBe("int");
    if (a.tag === "int") expect(a.value).toBe(-7n);
  });

  test("wraps to 63-bit signed", () => {
    // 2^62 wraps: asIntN(63, 2^62) = -2^62
    const a = mustRead("4611686018427387904"); // 2^62
    expect(a.tag).toBe("int");
    if (a.tag === "int") {
      expect(a.value).toBe(-(1n << 62n));
    }
  });

  test("round-trip ints", () => {
    for (const s of ["0", "1", "-1", "9001"]) {
      const a = mustRead(s);
      expect(astEqual(a, mustRead(print(a)))).toBe(true);
    }
  });
});

describe("bools", () => {
  test("true and false", () => {
    const t = mustRead("true");
    const f = mustRead("false");
    expect(t).toMatchObject({ tag: "bool", value: true });
    expect(f).toMatchObject({ tag: "bool", value: false });
  });

  test("round-trip", () => {
    expect(astEqual(mustRead("true"), mustRead(print(mustRead("true"))))).toBe(
      true,
    );
  });
});

describe("strings", () => {
  test("empty string", () => {
    const a = mustRead('""');
    expect(a.tag).toBe("str");
    if (a.tag === "str") expect(a.bytes.length).toBe(0);
  });

  test("escapes only backslash and quote", () => {
    const a = mustRead('"a\\"b\\\\c"');
    expect(a.tag).toBe("str");
    if (a.tag === "str") {
      expect([...a.bytes]).toEqual([0x61, 0x22, 0x62, 0x5c, 0x63]);
    }
  });

  test("invalid escape is an error", () => {
    const r = read('"\\n"');
    expect(r.ok).toBe(false);
  });

  test("raw non-UTF-8 bytes", () => {
    const src = new Uint8Array([0x22, 0xff, 0xfe, 0x22]); // "\xff\xfe"
    const a = mustRead(src);
    expect(a.tag).toBe("str");
    if (a.tag === "str") {
      expect([...a.bytes]).toEqual([0xff, 0xfe]);
    }
    const printed = print(a);
    expect([...printed]).toEqual([0x22, 0xff, 0xfe, 0x22]);
    expect(astEqual(a, mustRead(printed))).toBe(true);
  });

  test("NUL inside string", () => {
    const src = new Uint8Array([0x22, 0x00, 0x22]);
    const a = mustRead(src);
    expect(a.tag).toBe("str");
    if (a.tag === "str") expect([...a.bytes]).toEqual([0x00]);
  });
});

describe("floats", () => {
  test("decimal float", () => {
    const a = mustRead("1.5");
    expect(a.tag).toBe("float");
    if (a.tag === "float") expect(a.value).toBe(1.5);
  });

  test("exponent", () => {
    const a = mustRead("1e2");
    expect(a.tag).toBe("float");
    if (a.tag === "float") expect(a.value).toBe(100);
  });

  test("negative zero round-trips distinctly", () => {
    const a = mustRead("-0.0");
    expect(a.tag).toBe("float");
    if (a.tag === "float") expect(Object.is(a.value, -0)).toBe(true);
    const b = mustRead(print(a));
    expect(astEqual(a, b)).toBe(true);
  });
});

describe("comments", () => {
  test("line comments are skipped", () => {
    const a = mustRead("; hi\n42");
    expect(a.tag).toBe("int");
    if (a.tag === "int") expect(a.value).toBe(42n);
  });
});
