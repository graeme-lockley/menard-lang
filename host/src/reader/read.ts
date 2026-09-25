import type { Span } from "./span.ts";
import type { Ast } from "./ast.ts";

export type ParseError = {
  span: Span;
  message: string;
};

export type ReadOk = { ok: true; ast: Ast };
export type ReadErr = { ok: false; error: ParseError };
export type ReadResult = ReadOk | ReadErr;

export type ReadAllOk = { ok: true; forms: Ast[] };
export type ReadAllResult = ReadAllOk | ReadErr;

const enc = new TextEncoder();
const dec = new TextDecoder();

function err(start: number, end: number, message: string): ReadErr {
  return { ok: false, error: { span: { start, end }, message } };
}

function isWs(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;
}

function isDigit(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}

function isIdentStart(b: number): boolean {
  if (b >= 0x41 && b <= 0x5a) return true;
  if (b >= 0x61 && b <= 0x7a) return true;
  switch (b) {
    case 0x21: // !
    case 0x24: // $
    case 0x25: // %
    case 0x26: // &
    case 0x2a: // *
    case 0x2b: // +
    case 0x2d: // -
    case 0x2e: // .
    case 0x2f: // /
    case 0x3a: // :
    case 0x3c: // <
    case 0x3d: // =
    case 0x3e: // >
    case 0x3f: // ?
    case 0x40: // @
    case 0x5e: // ^
    case 0x5f: // _
    case 0x7c: // |
    case 0x7e: // ~
      return true;
    default:
      return false;
  }
}

function isIdentCont(b: number): boolean {
  return isIdentStart(b) || isDigit(b);
}

function nameEqualsAscii(name: Uint8Array, ascii: string): boolean {
  if (name.length !== ascii.length) return false;
  for (let i = 0; i < name.length; i++) {
    if (name[i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

class Reader {
  pos = 0;

  constructor(private readonly src: Uint8Array) {}

  peek(): number | undefined {
    return this.src[this.pos];
  }

  advance(): number | undefined {
    const b = this.src[this.pos];
    if (b !== undefined) this.pos++;
    return b;
  }

  skipWsAndComments(): void {
    for (;;) {
      while (this.pos < this.src.length && isWs(this.src[this.pos]!)) this.pos++;
      if (this.peek() === 0x3b) {
        while (this.pos < this.src.length && this.src[this.pos] !== 0x0a) {
          this.pos++;
        }
        continue;
      }
      break;
    }
  }

  readForm(): ReadResult {
    this.skipWsAndComments();
    if (this.pos >= this.src.length) {
      return err(this.pos, this.pos, "unexpected end of input");
    }
    const b = this.peek()!;
    if (b === 0x28) return this.readList("paren", 0x29);
    if (b === 0x5b) return this.readList("bracket", 0x5d);
    if (b === 0x22) return this.readString();
    if (b === 0x2d || b === 0x2b) {
      const next = this.src[this.pos + 1];
      if (next !== undefined && (isDigit(next) || next === 0x2e)) {
        return this.readNumber();
      }
      return this.readSym();
    }
    if (
      isDigit(b) ||
      (b === 0x2e &&
        this.src[this.pos + 1] !== undefined &&
        isDigit(this.src[this.pos + 1]!))
    ) {
      return this.readNumber();
    }
    if (isIdentStart(b)) return this.readSym();
    return err(this.pos, this.pos + 1, `unexpected byte 0x${b.toString(16)}`);
  }

  readList(kind: "paren" | "bracket", close: number): ReadResult {
    const start = this.pos;
    this.advance();
    const elems: Ast[] = [];
    for (;;) {
      this.skipWsAndComments();
      if (this.pos >= this.src.length) {
        return err(start, this.pos, `unclosed ${kind === "paren" ? "(" : "["}`);
      }
      if (this.peek() === close) {
        this.advance();
        return {
          ok: true,
          ast: { tag: "list", kind, elems, span: { start, end: this.pos } },
        };
      }
      const r = this.readForm();
      if (!r.ok) return r;
      elems.push(r.ast);
    }
  }

  readString(): ReadResult {
    const start = this.pos;
    this.advance();
    const out: number[] = [];
    while (this.pos < this.src.length) {
      const b = this.advance()!;
      if (b === 0x22) {
        return {
          ok: true,
          ast: {
            tag: "str",
            bytes: Uint8Array.from(out),
            span: { start, end: this.pos },
          },
        };
      }
      if (b === 0x5c) {
        if (this.pos >= this.src.length) {
          return err(start, this.pos, "unterminated string");
        }
        const e = this.advance()!;
        if (e === 0x5c || e === 0x22) {
          out.push(e);
        } else {
          return err(this.pos - 2, this.pos, "invalid string escape");
        }
        continue;
      }
      out.push(b);
    }
    return err(start, this.pos, "unterminated string");
  }

  readNumber(): ReadResult {
    const start = this.pos;
    if (this.peek() === 0x2d || this.peek() === 0x2b) {
      this.advance();
    }
    let sawDot = false;
    let sawExp = false;
    let sawDigit = false;
    while (this.pos < this.src.length) {
      const b = this.peek()!;
      if (isDigit(b)) {
        sawDigit = true;
        this.advance();
        continue;
      }
      if (b === 0x2e && !sawDot && !sawExp) {
        sawDot = true;
        this.advance();
        continue;
      }
      if ((b === 0x65 || b === 0x45) && !sawExp && sawDigit) {
        sawExp = true;
        this.advance();
        if (this.peek() === 0x2d || this.peek() === 0x2b) this.advance();
        if (this.peek() === undefined || !isDigit(this.peek()!)) {
          return err(start, this.pos, "malformed float exponent");
        }
        continue;
      }
      break;
    }
    if (!sawDigit) {
      this.pos = start;
      return this.readSym();
    }
    const text = dec.decode(this.src.subarray(start, this.pos));
    const end = this.pos;
    if (sawDot || sawExp) {
      const value = Number(text);
      if (!Number.isFinite(value)) {
        return err(start, end, "invalid float");
      }
      return { ok: true, ast: { tag: "float", value, span: { start, end } } };
    }
    const raw = text.startsWith("+") ? text.slice(1) : text;
    let value: bigint;
    try {
      value = BigInt(raw);
    } catch {
      return err(start, end, "invalid integer");
    }
    value = BigInt.asIntN(63, value);
    return { ok: true, ast: { tag: "int", value, span: { start, end } } };
  }

  readSym(): ReadResult {
    const start = this.pos;
    if (this.pos >= this.src.length || !isIdentStart(this.peek()!)) {
      return err(this.pos, this.pos + 1, "expected identifier");
    }
    while (this.pos < this.src.length && isIdentCont(this.src[this.pos]!)) {
      this.pos++;
    }
    const name = this.src.slice(start, this.pos);
    for (let k = 0; k < name.length; k++) {
      if (name[k] === 0x21 && k !== name.length - 1) {
        return err(
          start,
          this.pos,
          "'!' may appear only as the final character of an identifier",
        );
      }
    }
    const end = this.pos;
    if (nameEqualsAscii(name, "true")) {
      return { ok: true, ast: { tag: "bool", value: true, span: { start, end } } };
    }
    if (nameEqualsAscii(name, "false")) {
      return {
        ok: true,
        ast: { tag: "bool", value: false, span: { start, end } },
      };
    }
    return { ok: true, ast: { tag: "sym", name, span: { start, end } } };
  }
}

/** Read a single top-level form. Trailing junk after the form is an error. */
export function read(source: Uint8Array | string): ReadResult {
  const src = typeof source === "string" ? enc.encode(source) : source;
  const r = new Reader(src);
  const form = r.readForm();
  if (!form.ok) return form;
  r.skipWsAndComments();
  if (r.pos < src.length) {
    return err(r.pos, r.pos + 1, "unexpected trailing input");
  }
  return form;
}

/** Read all top-level forms (for corpus / multi-form files). */
export function readAll(source: Uint8Array | string): ReadAllResult {
  const src = typeof source === "string" ? enc.encode(source) : source;
  const r = new Reader(src);
  const forms: Ast[] = [];
  for (;;) {
    r.skipWsAndComments();
    if (r.pos >= src.length) break;
    const form = r.readForm();
    if (!form.ok) return form;
    forms.push(form.ast);
  }
  return { ok: true, forms };
}
