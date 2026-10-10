import { describe, expect, test } from "bun:test";
import { buildLineMap, offsetToLineCol } from "../../../host/src/diagnostic/line-map.ts";
import { read, readAll, print, astEqual } from "../../../host/src/reader/index.ts";

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
    const b = mustRead("sb-append!");
    expect(b.tag).toBe("sym");
    const call = mustRead("set!(1)");
    expect(call.tag).toBe("list");
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

  test("a bare arrow is not an identifier", () => {
    const r = read("->");
    expect(r.ok).toBe(false);
  });

  test("round-trip symbols", () => {
    for (const s of ["x", "map", "sb-append!", "fst:"]) {
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

  test("backslash and quote", () => {
    const a = mustRead('"a\\"b\\\\c"');
    expect(a.tag).toBe("str");
    if (a.tag === "str") {
      expect([...a.bytes]).toEqual([0x61, 0x22, 0x62, 0x5c, 0x63]);
    }
  });

  test("named escapes", () => {
    const a = mustRead('"\\n\\r\\t"');
    expect(a.tag).toBe("str");
    if (a.tag === "str") expect([...a.bytes]).toEqual([0x0a, 0x0d, 0x09]);
  });

  test("unicode scalar escapes encode UTF-8", () => {
    const cases: [string, number[]][] = [
      ['"\\u{0}"', [0x00]],
      ['"\\u{7f}"', [0x7f]],
      ['"\\u{80}"', [0xc2, 0x80]],
      ['"\\u{7ff}"', [0xdf, 0xbf]],
      ['"\\u{800}"', [0xe0, 0xa0, 0x80]],
      ['"\\u{e9}"', [0xc3, 0xa9]],
      ['"\\u{000A}"', [0x0a]],
      ['"\\u{1F600}"', [0xf0, 0x9f, 0x98, 0x80]],
      ['"\\u{10FFFF}"', [0xf4, 0x8f, 0xbf, 0xbf]],
    ];
    for (const [src, bytes] of cases) {
      const a = mustRead(src);
      expect(a.tag).toBe("str");
      if (a.tag === "str") expect([...a.bytes]).toEqual(bytes);
    }
  });

  test("dollar is a byte, not interpolation", () => {
    const a = mustRead('"$x${y}"');
    expect(a.tag).toBe("str");
    if (a.tag === "str") {
      expect([...a.bytes]).toEqual([0x24, 0x78, 0x24, 0x7b, 0x79, 0x7d]);
    }
  });

  test("a raw newline inside quotes is a newline byte", () => {
    const a = mustRead('"a\nb"');
    expect(a.tag).toBe("str");
    if (a.tag === "str") expect([...a.bytes]).toEqual([0x61, 0x0a, 0x62]);
  });

  test("an escaped newline round-trips through the raw show spelling", () => {
    const a = mustRead('"\\n"');
    expect(a.tag).toBe("str");
    if (a.tag !== "str") return;
    expect([...a.bytes]).toEqual([0x0a]);
    const printed = print(a);
    expect([...printed]).toEqual([0x22, 0x0a, 0x22]);
    expect(astEqual(a, mustRead(printed))).toBe(true);
  });

  test("invalid escape is an error", () => {
    for (const src of [
      '"\\q"',
      '"\\u"',
      '"\\u{}"',
      '"\\u{D800}"',
      '"\\u{dfff}"',
      '"\\u{110000}"',
      '"\\u{0000001}"',
      '"\\u{FFFFFF}"',
    ]) {
      const r = read(src);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toBe("invalid string escape");
    }
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

describe("character literals", () => {
  function charValue(src: string): bigint {
    const a = mustRead(src);
    if (a.tag !== "list" || a.elems[1]?.tag !== "int") {
      throw new Error("expected a char literal");
    }
    return a.elems[1].value;
  }

  test("one scalar between quotes", () => {
    expect(charValue("'A'")).toBe(65n);
    expect(new TextDecoder().decode(print(mustRead("'A'")))).toBe("'A'");
    expect(charValue("'😀'")).toBe(0x1f600n);
  });

  test("escapes", () => {
    expect(charValue("'\\n'")).toBe(10n);
    expect(charValue("'\\''")).toBe(39n);
    expect(charValue("'\\\\'")).toBe(92n);
    expect(charValue("'\\u{1F600}'")).toBe(0x1f600n);
    expect(new TextDecoder().decode(print(mustRead("'\\u{1F600}'")))).toBe("'\\u{1f600}'");
  });

  test("an unclosed quote is a symbol", () => {
    const a = mustRead("'red");
    expect(a.tag).toBe("list");
    if (a.tag === "list" && a.elems[1]?.tag === "sym") {
      expect(new TextDecoder().decode(a.elems[1].name)).toBe("red");
    }
  });

  test("empty quotes are rejected", () => {
    const r = read("''");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("empty character literal");
  });
});

describe("comments", () => {
  test("line comments are skipped", () => {
    const a = mustRead("; hi\n42");
    expect(a.tag).toBe("int");
    if (a.tag === "int") expect(a.value).toBe(42n);
  });
});

describe("shebang", () => {
  test("a leading shebang is ignored and the next line keeps its number", () => {
    const src = "#!/usr/bin/env mn\n42";
    const a = mustRead(src);
    expect(a.tag).toBe("int");
    if (a.tag === "int") {
      expect(a.value).toBe(42n);
      expect(offsetToLineCol(buildLineMap(new TextEncoder().encode(src)), a.span.start).line).toBe(2);
    }
  });

  test("a shebang program matches the same program without it", () => {
    const withShebang = readAll("#!/usr/bin/env mn\nlet main() -> Int = 0\n");
    const plain = readAll("let main() -> Int = 0\n");
    expect(withShebang.ok).toBe(true);
    expect(plain.ok).toBe(true);
    if (withShebang.ok && plain.ok) {
      expect(withShebang.forms.length).toBe(plain.forms.length);
      for (let i = 0; i < plain.forms.length; i++) {
        expect(astEqual(withShebang.forms[i]!, plain.forms[i]!)).toBe(true);
      }
    }
  });

  test("a shebang with no following program is an empty file", () => {
    const r = readAll("#!/usr/bin/env mn\n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.forms).toEqual([]);
  });

  test("a hash that is not the first two bytes is an error", () => {
    expect(read(" #!/usr/bin/env mn\n42").ok).toBe(false);
    expect(read("42\n#").ok).toBe(false);
  });
});
