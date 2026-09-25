import type { Ast } from "./ast.ts";

const enc = new TextEncoder();

function pushBytes(out: number[], bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!);
}

function pushStr(out: number[], s: string): void {
  pushBytes(out, enc.encode(s));
}

function printInto(ast: Ast, out: number[]): void {
  switch (ast.tag) {
    case "list": {
      out.push(ast.kind === "paren" ? 0x28 : 0x5b);
      for (let i = 0; i < ast.elems.length; i++) {
        if (i > 0) out.push(0x20);
        printInto(ast.elems[i]!, out);
      }
      out.push(ast.kind === "paren" ? 0x29 : 0x5d);
      return;
    }
    case "sym":
      pushBytes(out, ast.name);
      return;
    case "int":
      pushStr(out, ast.value.toString());
      return;
    case "float": {
      // Keep −0 distinct; ensure integer-valued floats re-lex as floats.
      if (Object.is(ast.value, -0)) {
        pushStr(out, "-0.0");
      } else if (Object.is(ast.value, 0)) {
        pushStr(out, "0.0");
      } else if (Number.isFinite(ast.value) && Number.isInteger(ast.value)) {
        pushStr(out, `${ast.value}.0`);
      } else {
        pushStr(out, String(ast.value));
      }
      return;
    }
    case "str": {
      out.push(0x22);
      for (let i = 0; i < ast.bytes.length; i++) {
        const b = ast.bytes[i]!;
        if (b === 0x5c || b === 0x22) out.push(0x5c);
        out.push(b);
      }
      out.push(0x22);
      return;
    }
    case "bool":
      pushStr(out, ast.value ? "true" : "false");
      return;
  }
}

/** Print a single Ast to bytes (canonical enough for round-trip). */
export function print(ast: Ast): Uint8Array {
  const out: number[] = [];
  printInto(ast, out);
  return Uint8Array.from(out);
}

/** Print top-level forms separated by newlines. */
export function printAll(forms: Ast[]): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < forms.length; i++) {
    if (i > 0) out.push(0x0a);
    printInto(forms[i]!, out);
  }
  if (forms.length > 0) out.push(0x0a);
  return Uint8Array.from(out);
}
