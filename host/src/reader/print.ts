import type { Ast } from "./ast.ts";

const dec = new TextDecoder();

function txt(a: Ast): string | null {
  return a.tag === "sym" ? dec.decode(a.name) : null;
}

function isList(a: Ast, kind?: "paren" | "bracket"): a is Ast & { tag: "list" } {
  return a.tag === "list" && (kind === undefined || a.kind === kind);
}

function head(a: Ast): string | null {
  if (!isList(a, "paren") || a.elems.length === 0) return null;
  return txt(a.elems[0]!);
}

const OPS = new Set(["+", "-", "*", "/", "%", "<", ">", "<=", ">=", "="]);

const OP_PREC: Record<string, number> = {
  "=": 4,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
};

/** Precedence of a printed operator, so a looser child keeps its parentheses. */
function rootPrec(a: Ast): number | null {
  const h = head(a);
  if (!h || !isList(a)) return null;
  if (h === "Cons" && a.elems.length === 3) return 5;
  if (h === "?") return 0;
  if (h === "|>") return 1;
  if (h === "or") return 2;
  if (h === "and") return 3;
  if (h === "not" && a.elems.length === 2 && head(a.elems[1]!) === "=") return 4;
  if (h === "-" && a.elems.length === 2) return 7;
  if (a.elems.length >= 3 && OP_PREC[h] !== undefined) return OP_PREC[h];
  return null;
}

function wrapOperand(parent: number, child: Ast, right: boolean, ind: number): string {
  const text = printExpr(child, ind);
  const cp = rootPrec(child);
  if (cp === null) return text;
  if (right ? cp <= parent : cp < parent) return `(${text})`;
  return text;
}

function encode(text: string): Uint8Array {
  return Buffer.from(text, "latin1");
}

export function print(ast: Ast): Uint8Array {
  return encode(printForm(ast, 0));
}

export function printAll(forms: Ast[]): Uint8Array {
  const parts: string[] = [];
  for (let i = 0; i < forms.length; i++) {
    if (i > 0) {
      const tight = head(forms[i - 1]!) === "import" && head(forms[i]!) === "import";
      parts.push(tight ? "\n" : "\n\n");
    }
    parts.push(printForm(forms[i]!, 0));
  }
  const body = parts.join("");
  return encode(body.length ? body + "\n" : "");
}

function printForm(ast: Ast, ind: number): string {
  if (head(ast) === "pub" && isList(ast)) {
    return "pub " + printForm(parenRest(ast), ind);
  }
  const h = head(ast);
  if (h === "defn" && isList(ast)) return printDefn(ast, ind);
  if (h === "defrec" && isList(ast)) return printRecord(ast, ind);
  if (h === "variant" && isList(ast)) return printVariant(ast, ind);
  if (h === "alias" && isList(ast)) return `alias ${printExpr(ast.elems[1]!, ind)} = ${printType(ast.elems[2]!)}`;
  if (h === "import" && isList(ast)) return printImport(ast);
  if (h === "extern" && isList(ast)) return printExtern(ast);
  if (h === "runtime" && isList(ast)) return printRuntime(ast);
  if (h === "test" && isList(ast)) return `test ${printAtom(ast.elems[1]!)} =${placed(ast.elems[2]!, ind + 2)}`;
  return printExpr(ast, ind);
}

function parenRest(ast: Ast & { tag: "list" }): Ast {
  return { tag: "list", kind: "paren", elems: ast.elems.slice(1), span: ast.span };
}

function printDefn(ast: Ast & { tag: "list" }, ind: number): string {
  const name = printDefnName(ast.elems[1]!);
  let i = 2;
  const params: string[] = [];
  while (i < ast.elems.length && txt(ast.elems[i]!) !== "->") {
    params.push(printParam(ast.elems[i]!));
    i++;
  }
  i++; // ->
  const ret = printType(ast.elems[i]!);
  i++;
  const bodies = ast.elems.slice(i);
  const sig = `let ${name}(${params.join(", ")}) -> ${ret}`;
  const asBlock =
    bodies.length !== 1 ||
    head(bodies[0]!) === "do" ||
    head(bodies[0]!) === "let";
  if (asBlock) {
    const wrapped: Ast & { tag: "list" } =
      bodies.length === 1 && head(bodies[0]!) === "do" && isList(bodies[0]!)
        ? bodies[0]
        : {
            tag: "list",
            kind: "paren",
            elems: [symDo(), ...bodies],
            span: ast.span,
          };
    return `${sig} ${printBlock(wrapped, ind)}`;
  }
  const body = bodies[0]!;
  const b = printExpr(body, ind + 2);
  return `${sig} =\n${pad(ind + 2)}${b}`;
}

function nameText(s: string): string {
  return RENAME[s] ?? s;
}

function printDefnName(a: Ast): string {
  if (a.tag === "sym") return nameText(txt(a)!);
  if (isList(a) && a.elems[0]?.tag === "sym") {
    if (a.elems.length === 1) return nameText(txt(a.elems[0])!);
    if (a.elems[1] && isList(a.elems[1], "bracket")) {
      const ps = a.elems[1].elems.map((e) => printAtom(e)).join(", ");
      return `${nameText(txt(a.elems[0])!)}[${ps}]`;
    }
  }
  return printAtom(a);
}

function printParam(a: Ast): string {
  if (!isList(a)) return printAtom(a);
  const name = txt(a.elems[0]!) ?? "";
  const bare = nameText(name.endsWith(":") ? name.slice(0, -1) : name);
  const rest = a.elems.some((e) => txt(e) === "...");
  const ty = a.elems[1] ? printType(a.elems[1]) : "";
  return `${rest ? "..." : ""}${bare}: ${ty}`;
}

function printRecord(ast: Ast & { tag: "list" }, ind: number): string {
  const name = printDefnName(ast.elems[1]!);
  const fields = ast.elems.slice(2).map((f) => `${pad(ind + 2)}${printField(f)}`);
  return `record ${name} {\n${fields.join("\n")}\n${pad(ind)}}`;
}

function printField(a: Ast): string {
  if (!isList(a)) return printAtom(a);
  const name = txt(a.elems[0]!) ?? "";
  const bare = name.endsWith(":") ? name.slice(0, -1) : name;
  return `${bare}: ${printType(a.elems[1]!)}`;
}

function printVariant(ast: Ast & { tag: "list" }, ind: number): string {
  const name = printDefnName(ast.elems[1]!);
  const ctors = ast.elems.slice(2).map((c) => `${pad(ind + 2)}| ${printCtor(c)}`);
  return `type ${name} =\n${ctors.join("\n")}`;
}

function printCtor(a: Ast): string {
  if (a.tag === "sym") return txt(a)!;
  if (!isList(a)) return printAtom(a);
  const n = printAtom(a.elems[0]!);
  if (a.elems.length === 1) return n;
  return `${n}(${a.elems.slice(1).map((e) => printType(e)).join(", ")})`;
}

function printExtern(ast: Ast & { tag: "list" }): string {
  const name = printDefnName(ast.elems[1]!);
  const params: string[] = [];
  let i = 2;
  while (i < ast.elems.length && txt(ast.elems[i]!) !== "->") {
    params.push(printParam(ast.elems[i]!));
    i++;
  }
  const ret = printType(ast.elems[i + 1]!);
  return `extern ${name}(${params.join(", ")}) -> ${ret}`;
}

function printRuntime(ast: Ast & { tag: "list" }): string {
  return printExtern(ast).replace(/^extern /, "runtime ");
}

function printBlock(ast: Ast & { tag: "list" }, ind: number): string {
  const lines = ast.elems.slice(1).map((e) => `${pad(ind + 2)}${printStmt(e, ind + 2)}`);
  return `{\n${lines.join("\n")}\n${pad(ind)}}`;
}

function printStmt(a: Ast, ind: number): string {
  if (head(a) === "let") return printForm(a, ind);
  return printExpr(a, ind);
}

function printExpr(a: Ast, ind: number): string {
  if (a.tag === "int") return a.value.toString();
  if (a.tag === "float") {
    if (Object.is(a.value, -0)) return "-0.0";
    const t = String(a.value);
    return t.includes(".") || t.includes("e") || t.includes("E") ? t : `${t}.0`;
  }
  if (a.tag === "bool") return a.value ? "true" : "false";
  if (a.tag === "str") return quoteStr(a.bytes);
  if (a.tag === "sym") return nameText(dec.decode(a.name));
  if (a.kind === "bracket") return `[${a.elems.map((e) => printExpr(e, ind)).join(", ")}]`;
  if (a.elems.length === 0) return "()";
  const h = txt(a.elems[0]!);
  if (h === "do") return printBlock(a, ind);
  if (h === "if") return printIf(a, ind);
  if (h === "cond") return printCond(a, ind);
  if (h === "when") return printWhen(a, ind);
  if (h === "match") return printMatch(a, ind);
  if (h === "fn") return printFn(a, ind);
  if (h === "pub") return "pub " + printForm({ tag: "list", kind: "paren", elems: a.elems.slice(1), span: a.span }, ind);
  if (h === "let") {
    if (a.elems.length === 3) return `let ${printAtom(a.elems[1]!)} =${placed(a.elems[2]!, ind + 2)}`;
    const binding: Ast = { tag: "list", kind: "paren", elems: [a.elems[0]!, a.elems[1]!, a.elems[2]!], span: a.span };
    return printBlock({ tag: "list", kind: "paren", elems: [symDo(), binding, ...a.elems.slice(3)], span: a.span }, ind);
  }
  if (h === "loop") return printLoop(a, ind);
  if (h === "while") return printWhile(a, ind);
  if (h === "quote" && a.elems[1]) return `'${printAtom(a.elems[1])}`;
  if (h === "|>") return printOp(a, "|>", ind);
  if (h === "?") return printQues(a, ind);
  if (h === "map-lit") return printMap(a, ind);
  if (h === "and" || h === "or") return printLogic(a, h === "and" ? "&&" : "||", ind);
  if (h === "not" && a.elems.length === 2 && head(a.elems[1]!) === "=") {
    const eq = a.elems[1] as Ast & { tag: "list" };
    return `${wrapOperand(4, eq.elems[1]!, false, ind)} != ${wrapOperand(4, eq.elems[2]!, true, ind)}`;
  }
  if (h === "project" && a.elems.length === 3) return printProject(a, ind);
  if (h === "Cons" && a.elems.length === 3) return printCons(a, ind);
  if (h && OPS.has(h) && a.elems.length >= 3) return printOp(a, h, ind);
  if (h === "-") {
    if (a.elems.length === 2) return `-${wrapOperand(7, a.elems[1]!, true, ind)}`;
    if (a.elems.length === 3) {
      return `${wrapOperand(5, a.elems[1]!, false, ind)} - ${wrapOperand(5, a.elems[2]!, true, ind)}`;
    }
  }
  if (h || (a.elems[0] && a.elems[0].tag === "list")) return printCall(a, ind);
  return "()";
}

function laidOut(a: Ast): boolean {
  const h = head(a);
  return h === "if" || h === "match" || h === "cond" || h === "when" || h === "loop";
}

/** Print `a` inline, or on the next line at `ind`, when it has layout bars. */
function placed(a: Ast, ind: number): string {
  if (head(a) === "do") return ` ${printExpr(a, ind - 2)}`;
  if (laidOut(a)) return `\n${pad(ind)}${printExpr(a, ind)}`;
  const text = printExpr(a, ind);
  if (text.includes("\n")) return `\n${pad(ind)}${text}`;
  return ` ${text}`;
}

function printImport(ast: Ast & { tag: "list" }): string {
  const path = printAtom(ast.elems[1]!);
  const alias = ast.elems[2];
  if (alias?.tag === "sym") return `import ${path} as ${nameText(dec.decode(alias.name))}`;
  return `import ${path}`;
}

function printProject(a: Ast & { tag: "list" }, ind: number): string {
  return `${projectLeft(a.elems[1]!, ind)}.${printAtom(a.elems[2]!)}`;
}

function projectLeft(obj: Ast, ind: number): string {
  if (obj.tag !== "list" || head(obj) === "project") return printExpr(obj, ind);
  const h = head(obj);
  if (
    h === "if" ||
    h === "cond" ||
    h === "match" ||
    h === "and" ||
    h === "or" ||
    h === "|>" ||
    h === "?" ||
    h === "Cons" ||
    h === "-" ||
    (h !== null && OPS.has(h))
  ) {
    return `(${printExpr(obj, ind)})`;
  }
  return printExpr(obj, ind);
}

function printCons(a: Ast & { tag: "list" }, ind: number): string {
  return `${wrapOperand(5, a.elems[1]!, true, ind)} :: ${wrapOperand(5, a.elems[2]!, false, ind)}`;
}

function printQues(a: Ast & { tag: "list" }, ind: number): string {
  return `${wrapOperand(0, a.elems[1]!, true, ind)} ? ${wrapOperand(0, a.elems[2]!, false, ind)}`;
}

function printMap(a: Ast & { tag: "list" }, ind: number): string {
  const entries = a.elems.slice(1);
  if (entries.length === 0) return "{}";
  return `{${entries.map((e) => printMapEntry(e, ind)).join(", ")}}`;
}

function printMapEntry(e: Ast, ind: number): string {
  if (e.tag !== "list") return printExpr(e, ind);
  const h = txt(e.elems[0]!);
  if (h === "..." && e.elems[1]) return `...${printExpr(e.elems[1], ind)}`;
  if (h === "=>" && e.elems[1] && e.elems[2]) {
    return `${printExpr(e.elems[1], ind)} => ${printExpr(e.elems[2], ind)}`;
  }
  return printExpr(e, ind);
}

function printOp(a: Ast & { tag: "list" }, op: string, ind: number): string {
  const surface = op === "=" ? "==" : op;
  const prec = rootPrec(a) ?? 0;
  const args = a.elems.slice(1).map((e, i) => wrapOperand(prec, e, i > 0, ind));
  if (a.elems.slice(1).some(laidOut)) {
    return args.map((t, i) => (laidOut(a.elems[i + 1]!) ? `\n${pad(ind + 2)}${printExpr(a.elems[i + 1]!, ind + 2)}` : t)).join(` ${surface} `);
  }
  if (op === "<" || op === ">" || op === "<=" || op === ">=" || op === "=") return args.join(` ${surface} `);
  let acc = args[0]!;
  for (let i = 1; i < args.length; i++) acc = `${acc} ${surface} ${args[i]}`;
  return acc;
}

function printLogic(a: Ast & { tag: "list" }, op: string, ind: number): string {
  const prec = op === "&&" ? 3 : 2;
  return a.elems
    .slice(1)
    .map((e, i) => wrapOperand(prec, e, i > 0, ind))
    .join(` ${op} `);
}

function printCall(a: Ast & { tag: "list" }, ind: number): string {
  const callee = a.elems[0]!;
  const f = callee.tag === "sym" ? printAtom(callee) : `(${printExpr(callee, ind)})`;
  const raw = a.elems.slice(1);
  const inline = formatCallArgs(raw, ind, false);
  if (!callNeedsHang(raw)) return `${f}(${inline})`;
  return `${f}(\n${formatCallArgs(raw, ind + 2, true)}\n${pad(ind)})`;
}

function callNeedsHang(raw: Ast[]): boolean {
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i]!;
    if (txt(e) === "..." && raw[i + 1]) {
      if (laidOut(raw[i + 1]!) || printExpr(raw[i + 1]!, 0).includes("\n")) return true;
      i++;
      continue;
    }
    if (laidOut(e) || printExpr(e, 0).includes("\n")) return true;
  }
  return false;
}

function formatCallArgs(raw: Ast[], ind: number, hang: boolean): string {
  const parts: string[] = [];
  const pre = hang ? pad(ind) : "";
  const sep = hang ? ",\n" : ", ";
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i]!;
    if (txt(e) === "..." && raw[i + 1]) {
      parts.push(`${pre}...${printExpr(raw[i + 1]!, ind)}`);
      i++;
      continue;
    }
    parts.push(`${pre}${txt(e) === "..." ? "..." : printExpr(e, ind)}`);
  }
  return parts.join(sep);
}

function arrowBody(body: Ast, ind: number): string {
  const text = printExpr(body, ind);
  const hang =
    text.includes("\n") ||
    head(body) === "if" ||
    head(body) === "match" ||
    head(body) === "loop" ||
    head(body) === "while" ||
    head(body) === "do";
  if (hang) return `\n${pad(ind)}${text}`;
  return ` ${text}`;
}

function isHeavy(body: Ast): boolean {
  const h = head(body);
  return h === "do" || h === "match" || h === "if" || h === "loop" || h === "while";
}

function useCond(arms: { test: Ast | null; body: Ast }[]): boolean {
  if (arms.length >= 3) return true;
  if (arms.some((a) => a.test !== null && arms.indexOf(a) > 0)) return true;
  return arms.some((a) => isHeavy(a.body));
}

function printIf(a: Ast & { tag: "list" }, ind: number): string {
  const arms = flattenIf(a);
  if (useCond(arms)) return printCondArms(arms, ind);
  const first = arms[0]!;
  const then = arrowBody(first.body, ind + 2);
  const test = printExpr(first.test!, ind);
  if (arms.length === 1 || arms[1]!.test !== null) return `if (${test}) ->${then}`;
  const els = printExpr(arms[1]!.body, ind);
  return `if (${test}) ->${then} | ${els}`;
}

function printCondArms(arms: { test: Ast | null; body: Ast }[], ind: number): string {
  const lines = ["cond"];
  for (const arm of arms) {
    const body = arrowBody(arm.body, ind + 4);
    if (arm.test === null) lines.push(`${pad(ind + 2)}| else ->${body}`);
    else lines.push(`${pad(ind + 2)}| ${printExpr(arm.test, ind + 2)} ->${body}`);
  }
  return lines.join("\n");
}

function flattenIf(a: Ast): { test: Ast | null; body: Ast }[] {
  if (head(a) !== "if" || !isList(a) || a.elems.length < 4) {
    return [{ test: null, body: a }];
  }
  const test = a.elems[1]!;
  const then = a.elems[2]!;
  const els = a.elems[3]!;
  if (isUnit(els)) return [{ test, body: then }];
  if (head(els) === "if") return [{ test, body: then }, ...flattenIf(els)];
  return [{ test, body: then }, { test: null, body: els }];
}

function isUnit(a: Ast): boolean {
  return a.tag === "list" && a.kind === "paren" && a.elems.length === 0;
}

function printCond(a: Ast & { tag: "list" }, ind: number): string {
  const clauses = a.elems.slice(1);
  const lines: string[] = ["cond"];
  for (const c of clauses) {
    if (!isList(c)) continue;
    const test = c.elems[0]!;
    const body: Ast =
      c.elems.length === 2
        ? c.elems[1]!
        : { tag: "list", kind: "paren", elems: [symDo(), ...c.elems.slice(1)], span: c.span };
    const b = arrowBody(body, ind + 4);
    if (txt(test) === "else") lines.push(`${pad(ind + 2)}| else ->${b}`);
    else lines.push(`${pad(ind + 2)}| ${printExpr(test, ind + 2)} ->${b}`);
  }
  return lines.join("\n");
}

function symDo(): Ast {
  return { tag: "sym", name: new TextEncoder().encode("do"), span: { start: 0, end: 0 } };
}

function printWhen(a: Ast & { tag: "list" }, ind: number): string {
  if (!a.elems[1]) return "when()";
  const test = a.elems[1];
  const rest = a.elems.slice(2);
  const body: Ast =
    rest.length === 1
      ? rest[0]!
      : { tag: "list", kind: "paren", elems: [symDo(), ...rest], span: a.span };
  return `if (${printExpr(test, ind)}) ->${arrowBody(body, ind + 2)}`;
}

function printMatch(a: Ast & { tag: "list" }, ind: number): string {
  const scrut = printExpr(a.elems[1]!, ind);
  const lines: string[] = [`match (${scrut})`];
  for (let i = 2; i + 1 < a.elems.length; i += 2) {
    lines.push(`${pad(ind + 2)}| ${printPat(a.elems[i]!)} ->${arrowBody(a.elems[i + 1]!, ind + 4)}`);
  }
  return lines.join("\n");
}

function printPat(a: Ast): string {
  if (a.tag !== "list") return printAtom(a);
  if (a.kind === "bracket") return `[${a.elems.map(printPat).join(", ")}]`;
  if (a.elems.length === 0) return "()";
  if (txt(a.elems[0]!) === "Cons" && a.elems.length === 3) {
    const leftAst = a.elems[1]!;
    const left = printPat(leftAst);
    const right = printPat(a.elems[2]!);
    const wrapped = leftAst.tag === "list" && txt(leftAst.elems[0]!) === "Cons" ? `(${left})` : left;
    return `${wrapped} :: ${right}`;
  }
  if (a.elems.length === 1 && a.elems[0]!.tag === "sym") {
    const n = txt(a.elems[0]!)!;
    if (n[0]! >= "A" && n[0]! <= "Z") return n;
  }
  const h = txt(a.elems[0]!);
  if (h) return `${h}(${a.elems.slice(1).map(printPat).join(", ")})`;
  return printExpr(a, 0);
}

function printFn(a: Ast & { tag: "list" }, ind: number): string {
  const params = isList(a.elems[1]!) ? a.elems[1].elems.map((p) => printAtom(p)).join(", ") : "";
  const body = a.elems[2]!;
  if (head(body) === "do" && isList(body)) return `fn (${params}) ${printBlock(body, ind)}`;
  const b = printExpr(body, ind + 2);
  if (!b.includes("\n") && !laidOut(body)) return `fn (${params}) = ${b}`;
  return `fn (${params}) =\n${pad(ind + 2)}${b}`;
}

function printLoop(a: Ast & { tag: "list" }, ind: number): string {
  const binds = isList(a.elems[1]!)
    ? a.elems[1].elems.map((b) => (isList(b) ? `${printAtom(b.elems[0]!)} = ${printExpr(b.elems[1]!, ind)}` : printAtom(b)))
    : [];
  return `loop (${binds.join(", ")})\n${pad(ind + 2)}${printExpr(a.elems[2]!, ind + 2)}`;
}

function printWhile(a: Ast & { tag: "list" }, ind: number): string {
  if (!a.elems[1]) return "while (()) {}";
  const test = printExpr(a.elems[1], ind);
  const body = { tag: "list" as const, kind: "paren" as const, elems: [symDo(), ...a.elems.slice(2)], span: a.span };
  return `while (${test}) ${printBlock(body, ind)}`;
}

function printType(a: Ast): string {
  if (a.tag === "sym") return dec.decode(a.name);
  if (a.tag !== "list") return printAtom(a);
  if (a.elems.length === 0) return "()";
  const h = txt(a.elems[0]!);
  if (h === "Fn") {
    const arrow = a.elems.findIndex((e) => txt(e) === "->");
    const ps = a.elems.slice(1, arrow < 0 ? a.elems.length : arrow);
    const ret = arrow >= 0 ? printType(a.elems[arrow + 1]!) : "?";
    if (ps.length === 0) return `() -> ${ret}`;
    if (ps.length === 1) return `(${printType(ps[0]!)}) -> ${ret}`;
    return `(${ps.map(printType).join(", ")}) -> ${ret}`;
  }
  const args = a.elems.slice(1).map((e) => {
    const p = printType(e);
    if (e.tag === "list") return `(${p})`;
    return p;
  });
  return `${h} ${args.join(" ")}`.trim();
}

const RENAME: Record<string, string> = {
  "status->exit-code": "status-exit-code",
  "block-terminated?": "block-terminated",
  "slot-store?": "slot-store",
  record: "scan-record",
  pub: "exported",
};

function printAtom(a: Ast): string {
  if (a.tag === "sym") {
    const s = dec.decode(a.name);
    return RENAME[s] ?? s;
  }
  if (a.tag === "str") return quoteStr(a.bytes);
  if (a.tag === "int") return a.value.toString();
  if (a.tag === "bool") return a.value ? "true" : "false";
  return printExpr(a, 0);
}

function quoteStr(bytes: Uint8Array): string {
  let s = '"';
  for (const b of bytes) {
    if (b === 0x5c || b === 0x22) s += "\\";
    s += String.fromCharCode(b);
  }
  return s + '"';
}

function pad(n: number): string {
  return " ".repeat(n);
}
