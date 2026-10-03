import { describe, expect, test } from "bun:test";
import { diagnose, run } from "../../../host/src/interp/index.ts";
import { formatDiagnostics } from "../../../host/src/diagnostic/index.ts";

describe("typer", () => {
  test("type mismatch reports E_TYPE_MISMATCH with span", () => {
    const src = `let f(x: Int) -> Int =
  "nope"`;
    const diags = diagnose(src);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some((d) => d.code === "E_TYPE_MISMATCH")).toBe(true);
    expect(diags[0]!.category).toBe("type");
    const formatted = formatDiagnostics(diags, src, "t.mnd");
    expect(formatted).toContain("error[E_TYPE_MISMATCH]");
    expect(formatted).toContain("t.mnd:");
  });

  test("unbound variable", () => {
    const diags = diagnose("x + 1");
    expect(diags.some((d) => d.code === "E_TYPE_UNBOUND")).toBe(true);
  });

  test("if requires Bool", () => {
    const diags = diagnose("if 1 -> 2\n | else -> 3");
    expect(diags.some((d) => d.code === "E_TYPE_MISMATCH")).toBe(true);
  });

  test("non-exhaustive match names missing ctor", () => {
    const src = `type T =
  | A
  | B

let f(x: T) -> Int =
  match (x)
    | A -> 1`;
    const diags = diagnose(src);
    expect(diags.some((d) => d.code === "E_TYPE_EXHAUSTIVE")).toBe(true);
    expect(diags.find((d) => d.code === "E_TYPE_EXHAUSTIVE")!.message).toContain("B");
  });

  test("show rejects Ref", () => {
    const src = `let f() -> Str =
  show(ref(1))`;
    const diags = diagnose(src);
    expect(diags.some((d) => d.code === "E_TYPE_SHOWABLE")).toBe(true);
  });

  test("print rejects non-showable Ref", () => {
    const diags = diagnose("print(ref(1))");
    expect(diags.some((d) => d.code === "E_TYPE_SHOWABLE")).toBe(true);
  });

  test("built-in constructors typecheck as expressions", () => {
    const cases = ["None()", "Some(1)", "Ok(1)", 'Err("e")', "Nil()", "Cons(1, Nil())"];
    for (const src of cases) {
      const diags = diagnose(src);
      expect(diags).toEqual([]);
    }
  });

  test("built-in constructors in typed defn bodies", () => {
    const src = `let f(n: Int) -> List Int =
  Cons(n, Nil())
let g(n: Int) -> Maybe Int =
  Some(n)
let h(n: Int) -> Result Int Str =
  Ok(n)
f(1)`;
    const diags = diagnose(src);
    expect(diags).toEqual([]);
  });

  test("loop/recur sum-to typechecks (spec §2.4)", () => {
    const src = `let sum-to(n: Int) -> Int =
  loop (i = 0, acc = 0)
    if i > n -> acc
     | else -> recur(i + 1, acc + i)
sum-to(10)`;
    const diags = diagnose(src);
    expect(diags).toEqual([]);
  });

  test("recur arity must match loop bindings", () => {
    const src = `let bad(n: Int) -> Int =
  loop (i = 0)
    if i > n -> i
     | else -> recur(i + 1, 0)`;
    const diags = diagnose(src);
    expect(diags.some((d) => d.code === "E_TYPE_ARITY" || d.code === "E_TYPE_RECUR")).toBe(
      true,
    );
  });

  test("recur outside loop is an error", () => {
    const diags = diagnose("recur(1)");
    expect(diags.some((d) => d.code === "E_TYPE_RECUR")).toBe(true);
  });

  test("sequential let in defn body scopes over later forms", () => {
    const src = `let f(n: Int) -> Int {
  let i = ref(n)
  set!(i, deref(i) + 1)
  deref(i)
}
f(41)`;
    const diags = diagnose(src);
    expect(diags).toEqual([]);
  });

  test("count-down (spec §2.4) typechecks", () => {
    const src = `let count-down(n: Int) -> Unit {
  let i = ref(n)
  while (deref(i) > 0) {
    print(deref(i))
    set!(i, deref(i) - 1)
  }
}
count-down(0)`;
    const diags = diagnose(src);
    expect(diags).toEqual([]);
  });

  test("top-level sequential let scopes over later forms", () => {
    const diags = diagnose("let x = 40\nx + 2");
    expect(diags).toEqual([]);
  });

  test("forward reference to later defn typechecks", () => {
    const src = `let g(n: Int) -> Int =
  mk(n)
let mk(n: Int) -> Int =
  n + 1
g(3)`;
    const diags = diagnose(src);
    expect(diags).toEqual([]);
  });

  test("mutual recursion typechecks", () => {
    const src = `let ev[a](x: a) -> Bool =
  od(x)
let od[a](x: a) -> Bool =
  ev(x)`;
    const diags = diagnose(src);
    expect(diags).toEqual([]);
  });
});

describe("pipeline diagnose", () => {
  test("syntax error stops before type", () => {
    const diags = diagnose("(a");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.category).toBe("syntax");
  });

  test("casing error", () => {
    const diags = diagnose("let Foo() -> Int = 1");
    expect(diags.some((d) => d.category === "casing")).toBe(true);
  });
});

describe("run", () => {
  test("evaluates arithmetic", () => {
    const r = run("2 + 3");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tag).toBe("int");
      if (r.value.tag === "int") expect(r.value.value).toBe(5n);
    }
  });

  test("division by zero panics", () => {
    const r = run("1 / 0");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("panic");
  });

  test("defn and call", () => {
    const src = `let add1(n: Int) -> Int =
  n + 1
add1(41)`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(42n);
  });

  test("closures", () => {
    const src = `let adder(n: Int) -> (Int) -> Int =
  fn (m) = n + m
adder(10)(7)`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(17n);
  });

  test("ref mutation", () => {
    const src = `{
  let r = ref(1)
  set!(r, 2)
  deref(r)
}`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(2n);
  });

  test("match variants", () => {
    const src = `type Tree =
  | Leaf(Int)
  | Empty

let sz(t: Tree) -> Int =
  match (t)
    | Empty -> 0
    | Leaf(_) -> 1
sz(Leaf(9))`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(1n);
  });

  test("built-in constructors evaluate", () => {
    const cases: { src: string; ctor: string }[] = [
      { src: "None()", ctor: "None" },
      { src: "Some(1)", ctor: "Some" },
      { src: "Ok(1)", ctor: "Ok" },
      { src: 'Err("e")', ctor: "Err" },
      { src: "Nil()", ctor: "Nil" },
      { src: "Cons(1, Nil())", ctor: "Cons" },
    ];
    for (const { src, ctor } of cases) {
      const r = run(src);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.tag).toBe("variant");
        if (r.value.tag === "variant") expect(r.value.ctor).toBe(ctor);
      }
    }
  });

  test("loop/recur sum-to evaluates", () => {
    const src = `let sum-to(n: Int) -> Int =
  loop (i = 0, acc = 0)
    if i > n -> acc
     | else -> recur(i + 1, acc + i)
sum-to(10)`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(55n);
  });

  test("sequential let in defn body evaluates", () => {
    const src = `let f(n: Int) -> Int {
  let i = ref(n)
  set!(i, deref(i) + 1)
  deref(i)
}
f(41)`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(42n);
  });

  test("count-down (spec §2.4) evaluates", () => {
    const src = `let count-down(n: Int) -> Unit {
  let i = ref(n)
  while (deref(i) > 0) {
    print(deref(i))
    set!(i, deref(i) - 1)
  }
}
count-down(0)`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tag).toBe("unit");
  });

  test("top-level sequential let evaluates", () => {
    const r = run("let x = 40\nx + 2");
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(42n);
  });

  test("forward reference to later defn evaluates", () => {
    const src = `let g(n: Int) -> Int =
  mk(n)
let mk(n: Int) -> Int =
  n + 1
g(3)`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "int") expect(r.value.value).toBe(4n);
  });

  test("mutual recursion evaluates with base case", () => {
    const src = `let is-even(n: Int) -> Bool =
  if n == 0 -> true
   | else -> is-odd(n - 1)
let is-odd(n: Int) -> Bool =
  if n == 0 -> false
   | else -> is-even(n - 1)
is-even(4)`;
    const r = run(src);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.tag === "bool") expect(r.value.value).toBe(true);
  });
});
