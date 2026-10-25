import { describe, expect, test } from "bun:test";
import { read, readAll, print, printAll, astEqual } from "../../../host/src/reader/index.ts";
import { lex } from "../../../host/src/reader/lex.ts";
import type { Ast } from "../../../host/src/reader/ast.ts";
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

function headOf(ast: Ast): string | null {
  if (ast.tag !== "list" || ast.elems[0]?.tag !== "sym") return null;
  return new TextDecoder().decode(ast.elems[0].name);
}

describe("infix surface", () => {
  test("binding and test blocks put the opening brace after equals", () => {
    const source = `let value = {
  let inner = {
    41
  }
  inner + 1
}

test "block value" = {
  value == 42
}
`;
    const forms = mustAll(source);
    expect(text(printAll(forms))).toBe(source);
    expect(mustAll(text(printAll(forms))).every((f, i) => astEqual(f, forms[i]!))).toBe(true);
  });

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

  test("cond arms sit under the keyword and a missing else is unit", () => {
    const forms = mustAll(`
let sign(n: Int) -> Str =
  cond
    | n < 0 -> "negative"
    | n == 0 -> "zero"
    | else -> "positive"

let poke() -> Unit =
  if (ready) -> println("go")
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

  test("a parameter-list let is legal below column 0", () => {
    const forms = mustAll(`
let outer() -> Int {
  let inner(n: Int) -> Int =
    n
  inner(1)
}
`);
    expect(forms.length).toBe(1);
    const form = forms[0];
    if (!form || form.tag !== "list") throw new Error("expected a list");
    const body = form.elems[form.elems.length - 1];
    if (!body) throw new Error("expected a body");
    expect(text(print(body))).toContain("fn");
  });

  test("a bar at the beginning of a line is not an if else", () => {
    const r = readAll(`
let f(n: Int) -> Int =
  if (n == 0) -> 1
  | 2
`);
    expect(r.ok).toBe(false);
  });

  test(":: is right-associative cons in expressions and patterns", () => {
    const expr = mustRead("1 :: 2 :: []");
    const again = mustRead(text(print(expr)));
    expect(astEqual(expr, again)).toBe(true);
    const forms = mustAll(`
let f(xs: List Int) -> Int =
  match (xs)
    | x :: xs -> x
    | [] -> 0
`);
    expect(astEqual(mustAll(text(printAll(forms)))[0]!, forms[0]!)).toBe(true);
  });

  test("named record patterns and multi-value match round-trip", () => {
    const forms = mustAll(`
let f(sp: Span, xs: List Int, ys: List Int) -> Int =
  match (sp)
    | Span { line, start } -> line
let g(xs: List Int, ys: List Int) -> Int =
  match (xs, ys)
    | ([], []) -> 0
    | (x :: xt, y :: yt) when x == y -> g(xt, yt)
    | (_, _) -> 1
`);
    expect(astEqual(mustAll(text(printAll(forms)))[0]!, forms[0]!)).toBe(true);
    const printed = text(printAll(forms));
    expect(printed).toContain("Span { line, start }");
    expect(printed).toContain("match (xs, ys)");
    expect(printed).toContain("when x == y");
  });

  test("|> is one token, needs whitespace, and an arm bar stays a bar", () => {
    const piped = lex(new TextEncoder().encode("a |> b"));
    expect(piped.ok).toBe(true);
    if (piped.ok) expect(piped.toks.filter((t) => t.kind !== "eof").map((t) => t.text)).toEqual(["a", "|>", "b"]);
    expect(read("a|>b").ok).toBe(false);
    const arm = lex(new TextEncoder().encode("| n < 0 -> 1"));
    expect(arm.ok).toBe(true);
    if (arm.ok) {
      const ops = arm.toks.filter((t) => t.kind === "op").map((t) => t.text);
      expect(ops).toEqual(["|", "<", "->"]);
    }
  });

  test("|> binds looser than + and associates to the left", () => {
    const a = mustRead("a + b |> f(c) |> g(d)");
    expect(text(print(a))).toBe("a + b |> f(c) |> g(d)");
    expect(astEqual(mustRead(text(print(a))), a)).toBe(true);
    expect(headOf(a)).toBe("|>");
    if (a.tag === "list") {
      expect(headOf(a.elems[1]!)).toBe("|>");
      expect(headOf(a.elems[2]!)).toBe("g");
      const inner = a.elems[1]!;
      if (inner.tag === "list") expect(headOf(inner.elems[1]!)).toBe("+");
    }
    const looser = mustRead("a || b |> f(c)");
    expect(headOf(looser)).toBe("|>");
    if (looser.tag === "list") expect(headOf(looser.elems[1]!)).toBe("or");
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

  test("projection and qualified import round-trip", () => {
    const forms = mustAll(`
import "./lexer.mnd" as Lexer
import std/list as List
let n(p: Int) -> Int = (p + 1).fst
`);
    const printed = text(printAll(forms));
    expect(printed).toContain('import "./lexer.mnd" as Lexer');
    expect(printed).toContain("import std/list as List");
    expect(printed).toContain("(p + 1).fst");
    const again = mustAll(printed);
    expect(astEqual(forms[0]!, again[0]!)).toBe(true);
  });

  test("qualified type names round-trip", () => {
    const forms = mustAll(`
import std/json as Json
let f(j: Json.Json) -> Int = 0
`);
    const printed = text(printAll(forms));
    expect(printed).toContain("j: Json.Json");
    const again = mustAll(printed);
    expect(astEqual(forms[1]!, again[1]!)).toBe(true);
  });

  test("qualified constructor patterns round-trip", () => {
    const forms = mustAll(`
import std/json as Json
let f(j: Json.Json) -> Int =
  match (j)
    | Json.JsonFloat(x) -> 1
    | Json.JsonNull -> 0
    | _ -> 2
`);
    const printed = text(printAll(forms));
    expect(printed).toContain("Json.JsonFloat(x)");
    expect(printed).toContain("Json.JsonNull");
    const again = mustAll(printed);
    expect(astEqual(forms[1]!, again[1]!)).toBe(true);
  });

  test("a chained field is nested projection", () => {
    const a = mustRead("o.inner.n");
    expect(text(print(a))).toBe("o.inner.n");
    if (a.tag === "list" && a.elems[1]?.tag === "list") {
      const inner = a.elems[1];
      expect(inner.elems[0] && inner.elems[0].tag === "sym" ? new TextDecoder().decode(inner.elems[0].name) : "").toBe("project");
    }
  });

  test("kebab-case and glued signs stay one token", () => {
    expect(sym(mustRead("str-concat"))).toBe("str-concat");
    expect(sym(mustRead("std/list"))).toBe("std/list");
    const neg = mustRead("-3");
    expect(neg.tag).toBe("int");
    if (neg.tag === "int") expect(neg.value).toBe(-3n);
  });
});

describe("map literals and question", () => {
  function roundTrip(src: string) {
    const a = mustRead(src);
    const printed = text(print(a));
    const b = mustRead(printed);
    expect(astEqual(a, b)).toBe(true);
    expect(text(print(b))).toBe(printed);
  }

  test("empty map, pairs, spreads, and question round-trip", () => {
    roundTrip("{}");
    roundTrip('{"a" => 1, "b" => 2}');
    roundTrip('{...x, "a" => 1, ...y}');
    roundTrip("a ? b ? c");
  });

  test("annotated and patterned fn round-trip", () => {
    roundTrip("fn (p: Str * Int) -> Int = p.2");
    roundTrip("fn ((x, y)) = x + y");
    roundTrip("fn (a, (_, v)) = a + v");
  });

  test("a brace around one expression stays a block", () => {
    const ast = mustRead("{ 1 }");
    expect(headOf(ast)).toBe("do");
    expect(text(print(ast))).toContain("{");
    expect(text(print(mustRead("{}"))).trim()).toBe("{}");
  });

  test("question is looser than pipe and associates right", () => {
    const piped = mustRead("xs |> List.head() ? 0");
    expect(headOf(piped)).toBe("?");
    if (piped.tag === "list") expect(headOf(piped.elems[1]!)).toBe("|>");
    const chain = mustRead("a ? b ? c");
    expect(headOf(chain)).toBe("?");
    if (chain.tag === "list") expect(headOf(chain.elems[2]!)).toBe("?");
  });

  test("question and fat arrow need whitespace on both sides", () => {
    const ques = lex(Buffer.from("a?b"));
    expect(ques.ok).toBe(false);
    if (!ques.ok) expect(ques.error.message).toContain("whitespace");
    const arrow = lex(Buffer.from('"a"=>1'));
    expect(arrow.ok).toBe(false);
    if (!arrow.ok) expect(arrow.error.message).toContain("whitespace");
  });

  test("a map entry needs a value", () => {
    const r = read('{"a" => }');
    expect(r.ok).toBe(false);
  });
});

describe("caml tuples", () => {
  test("product types, literals, and projection round-trip", () => {
    const forms = mustAll(`
let make() -> Int * Str * Bool =
  (1, "a", true)
let a = make().1
let b = make().2
`);
    expect(headOf(forms[0]!)).toBe("defn");
    const printed = text(printAll(forms));
    expect(printed).toContain("Int * Str * Bool");
    expect(printed).toContain('(1, "a", true)');
    expect(printed).toContain(".1");
    expect(mustAll(printed).every((f, i) => astEqual(f, forms[i]!))).toBe(true);
  });

  test("tuple patterns in match arms", () => {
    const forms = mustAll(`
let f(p: Int * Str) -> Int =
  match (p)
    | (n, _) -> n
`);
    expect(text(printAll(forms))).toContain("(n, _)");
  });
});

describe("missing if else", () => {
  test("a Unit arm may omit else", () => {
    const forms = mustAll(`
let poke(ready: Bool) -> Unit =
  if (ready) -> println("go")
`);
    const typed = typecheckForms(forms);
    expect(typed.diagnostics.filter((d) => d.code === "E_TYPE_MISMATCH")).toEqual([]);
  });

  test("a non-Unit arm without else is a type error", () => {
    const forms = mustAll(`
let f(ready: Bool) -> Int =
  if (ready) -> 1
`);
    const typed = typecheckForms(forms);
    expect(typed.diagnostics.some((d) => d.code === "E_TYPE_MISMATCH")).toBe(true);
  });
});
