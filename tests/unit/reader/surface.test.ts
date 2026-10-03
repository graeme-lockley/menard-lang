import { describe, expect, test } from "bun:test";
import { read, readAll, print, printAll, astEqual } from "../../../host/src/reader/index.ts";
import { typecheckForms } from "../../../host/src/type/check.ts";

function mustRead(src: string) {
  const r = read(src);
  if (!r.ok) throw new Error(`${r.error.message} @ ${r.error.span.start}`);
  return r.ast;
}

function mustAll(src: string) {
  const r = readAll(src);
  if (!r.ok) throw new Error(`${r.error.message} @ ${r.error.span.start}`);
  return r.forms;
}

function text(ast: Uint8Array): string {
  return new TextDecoder().decode(ast);
}

function sym(ast: ReturnType<typeof mustRead>): string {
  if (ast.tag !== "sym") throw new Error("expected sym");
  return new TextDecoder().decode(ast.name);
}

describe("infix surface", () => {
  test("arithmetic lowers left-associative with precedence", () => {
    const a = mustRead("1 + 2 * 3");
    expect(text(print(a))).toBe("1 + 2 * 3");
    const again = mustRead(text(print(a)));
    expect(astEqual(a, again)).toBe(true);
    if (a.tag === "list") {
      const head = a.elems[0];
      expect(head && head.tag === "sym" ? new TextDecoder().decode(head.name) : "").toBe("+");
    }
  });

  test("calls, lists, and quotes", () => {
    const forms = mustAll(`
let pair(x: Int, y: Int) -> Int =
  f(x, [y, 1], 'red)
`);
    const form = forms[0]!;
    const body = form.tag === "list" ? form.elems[form.elems.length - 1]! : form;
    expect(text(print(body))).toBe('f(x, [y, 1], \'red)');
  });

  test("if bars sit one column past the keyword and a missing else is unit", () => {
    const forms = mustAll(`
let sign(n: Int) -> Str =
  if n < 0 -> "negative"
   | n == 0 -> "zero"
   | else "positive"

let poke() -> Unit =
  if ready -> println("go")
`);
    const sign = forms[0]!;
    const poke = forms[1]!;
    expect(astEqual(mustAll(text(printAll(forms)))[0]!, sign)).toBe(true);
    if (poke.tag === "list") {
      const body = poke.elems.at(-1)!;
      if (body.tag === "list") {
        const els = body.elems[3]!;
        expect(els.tag).toBe("list");
        if (els.tag === "list") expect(els.elems.length).toBe(0);
      }
    }
  });

  test("record, variant, and alias", () => {
    const forms = mustAll(`
record Counts {
  passed: Int
  failed: Int
}

type Tree[a] =
  | Empty
  | Leaf(a)
  | Node(Tree a, Tree a)

alias Ints = List Int
`);
    expect(forms.length).toBe(3);
    const again = mustAll(text(printAll(forms)));
    expect(forms.every((f, i) => astEqual(f, again[i]!))).toBe(true);
  });

  test("a parameter-list let below column 0 is rejected", () => {
    const r = readAll(`
let outer() -> Int {
  let inner(n: Int) -> Int =
    n
  inner(1)
}
`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("parameter-list");
  });

  test("a bar at the wrong column is not an arm", () => {
    const r = readAll(`
let f(n: Int) -> Int =
  if n == 0 -> 1
    | else -> 2
`);
    expect(r.ok).toBe(false);
  });

  test("operators need whitespace and bangs stay final", () => {
    expect(read("a==b").ok).toBe(false);
    const bang = read("a!b");
    expect(bang.ok).toBe(false);
    if (!bang.ok) expect(bang.error.message).toContain("'!'");
  });

  test("tabs in the indent are a lexical error", () => {
    const r = readAll("let f() -> Int =\n\t1\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("tab");
  });

  test("unclosed delimiters say unclosed", () => {
    const r = readAll("let f() -> Int {\n  1\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("unclosed");
  });

  test("kebab-case and glued signs stay one token", () => {
    expect(sym(mustRead("str-concat"))).toBe("str-concat");
    expect(sym(mustRead("std/list"))).toBe("std/list");
    const neg = mustRead("-3");
    expect(neg.tag).toBe("int");
    if (neg.tag === "int") expect(neg.value).toBe(-3n);
  });
});

describe("missing if else", () => {
  test("a Unit arm may omit else", () => {
    const forms = mustAll(`
let poke(ready: Bool) -> Unit =
  if ready -> println("go")
`);
    const typed = typecheckForms(forms);
    expect(typed.diagnostics.filter((d) => d.code === "E_TYPE_MISMATCH")).toEqual([]);
  });

  test("a non-Unit arm without else is a type error", () => {
    const forms = mustAll(`
let f(ready: Bool) -> Int =
  if ready -> 1
`);
    const typed = typecheckForms(forms);
    expect(typed.diagnostics.some((d) => d.code === "E_TYPE_MISMATCH")).toBe(true);
  });
});
