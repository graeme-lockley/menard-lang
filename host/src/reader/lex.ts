import type { Span } from "./span.ts";

export type TokKind =
  | "ident"
  | "int"
  | "float"
  | "str"
  | "sym"
  | "kw"
  | "op"
  | "punct"
  | "eof";

export type Tok = {
  kind: TokKind;
  text: string;
  span: Span;
  /** Column of the first character. */
  col: number;
  /** Indent of the line this token sits on. */
  indent: number;
  /** True when this token is the first on its line. */
  bol: boolean;
  line: number;
};

const KEYWORDS = new Set([
  "alias",
  "cond",
  "else",
  "extern",
  "fn",
  "if",
  "import",
  "let",
  "loop",
  "match",
  "panic",
  "pub",
  "record",
  "recur",
  "ref",
  "deref",
  "return",
  "set!",
  "type",
  "while",
  "when",
]);

export type LexErr = { span: Span; message: string };

function isLetter(b: number): boolean {
  return (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
}
function isDigit(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}
function isIdentCont(b: number): boolean {
  return (
    isLetter(b) ||
    isDigit(b) ||
    b === 0x5f || // _
    b === 0x2d || // -
    b === 0x2b || // +
    b === 0x2a || // *
    b === 0x2f || // /
    b === 0x25 || // %
    b === 0x3c || // <
    b === 0x3e || // >
    b === 0x3a || // :
    b === 0x40 // @
  );
}

const OPS = ["==", "!=", "<=", ">=", "&&", "||", "->", "::", "|>", "+", "-", "*", "/", "%", "<", ">", "=", "|"];

/** Kestrel's simple escapes. `-1` means this byte is not one of them. */
function simpleEscape(e: number): number {
  if (e === 0x5c || e === 0x22) return e; // \\ \"
  if (e === 0x6e) return 0x0a; // \n
  if (e === 0x72) return 0x0d; // \r
  if (e === 0x74) return 0x09; // \t
  return -1;
}

function hexVal(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x61 && b <= 0x66) return b - 0x61 + 10;
  if (b >= 0x41 && b <= 0x46) return b - 0x41 + 10;
  return -1;
}

/** UTF-8 of one Unicode scalar. The caller has already rejected non-scalars. */
function pushUtf8(out: number[], cp: number): void {
  if (cp <= 0x7f) {
    out.push(cp);
    return;
  }
  if (cp <= 0x7ff) {
    out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    return;
  }
  if (cp <= 0xffff) {
    out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    return;
  }
  out.push(
    0xf0 | (cp >> 18),
    0x80 | ((cp >> 12) & 0x3f),
    0x80 | ((cp >> 6) & 0x3f),
    0x80 | (cp & 0x3f),
  );
}

export function lex(src: Uint8Array): { ok: true; toks: Tok[] } | { ok: false; error: LexErr } {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let col = 0;
  let indent = 0;
  let bol = true;
  let atLineStart = true;

  const err = (start: number, end: number, message: string): { ok: false; error: LexErr } => ({
    ok: false,
    error: { span: { start, end }, message },
  });

  const peek = (k = 0) => (i + k < src.length ? src[i + k]! : -1);

  function bump(): number {
    const b = src[i++]!;
    if (b === 0x0a) {
      line++;
      col = 0;
    } else {
      col++;
    }
    return b;
  }

  // `\u{` hex `}` — 1 to 6 digits, one Unicode scalar (no surrogates, ≤ U+10FFFF).
  function readUnicodeScalar(
    escAt: number,
    strAt: number,
  ): { ok: true; cp: number } | { ok: false; error: LexErr } {
    if (peek() === -1) return err(strAt, i, "unterminated string");
    if (peek() !== 0x7b) return err(escAt, i, "invalid string escape");
    bump();
    let cp = 0;
    let digits = 0;
    while (digits < 6 && hexVal(peek()) >= 0) {
      cp = cp * 16 + hexVal(peek());
      bump();
      digits++;
    }
    if (peek() === -1) return err(strAt, i, "unterminated string");
    if (digits === 0 || hexVal(peek()) >= 0 || peek() !== 0x7d) {
      return err(escAt, i, "invalid string escape");
    }
    bump();
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      return err(escAt, i, "invalid string escape");
    }
    return { ok: true, cp };
  }

  while (i < src.length) {
    if (atLineStart) {
      const start = i;
      indent = 0;
      while (peek() === 0x20) {
        bump();
        indent++;
      }
      if (peek() === 0x09) return err(i, i + 1, "tab in leading whitespace");
      atLineStart = false;
      bol = true;
      if (peek() === 0x0d) bump();
      if (peek() === 0x0a) {
        bump();
        atLineStart = true;
        continue;
      }
      if (peek() === 0x3b) {
        while (i < src.length && peek() !== 0x0a) bump();
        continue;
      }
      if (i >= src.length) break;
      void start;
    }

    const b = peek();
    if (b === 0x20 || b === 0x09 || b === 0x0d) {
      bump();
      bol = false;
      continue;
    }
    if (b === 0x0a) {
      bump();
      atLineStart = true;
      continue;
    }
    if (b === 0x3b) {
      while (i < src.length && peek() !== 0x0a) bump();
      continue;
    }

    const start = i;
    const tokCol = col;
    const tokLine = line;
    const tokIndent = indent;
    const tokBol = bol;
    bol = false;

    if (b === 0x22) {
      bump();
      const out: number[] = [];
      while (i < src.length) {
        const c = bump();
        if (c === 0x22) {
          toks.push({
            kind: "str",
            text: Buffer.from(out).toString("latin1"),
            span: { start, end: i },
            col: tokCol,
            indent: tokIndent,
            bol: tokBol,
            line: tokLine,
          });
          break;
        }
        if (c === 0x5c) {
          const escAt = i - 1;
          if (i >= src.length) return err(start, i, "unterminated string");
          const e = bump();
          const simple = simpleEscape(e);
          if (simple >= 0) {
            out.push(simple);
            continue;
          }
          if (e !== 0x75) return err(escAt, i, "invalid string escape");
          const scalar = readUnicodeScalar(escAt, start);
          if (!scalar.ok) return scalar;
          pushUtf8(out, scalar.cp);
          continue;
        }
        out.push(c);
      }
      if (toks.length === 0 || toks[toks.length - 1]!.span.start !== start) {
        return err(start, i, "unterminated string");
      }
      continue;
    }

    if (b === 0x27) {
      bump();
      if (!isLetter(peek())) return err(start, i, "symbol literal requires an identifier");
      const ns = i;
      bump();
      while (isIdentCont(peek()) || peek() === 0x21) bump();
      const name = Buffer.from(src.subarray(ns, i)).toString("utf8");
      if (name.includes("!") && !name.endsWith("!")) {
        return err(ns, i, "'!' may appear only as the final character of an identifier");
      }
      toks.push({
        kind: "sym",
        text: name,
        span: { start, end: i },
        col: tokCol,
        indent: tokIndent,
        bol: tokBol,
        line: tokLine,
      });
      continue;
    }

    if (b === 0x2e && peek(1) === 0x2e && peek(2) === 0x2e) {
      bump();
      bump();
      bump();
      toks.push({
        kind: "ident",
        text: "...",
        span: { start, end: i },
        col: tokCol,
        indent: tokIndent,
        bol: tokBol,
        line: tokLine,
      });
      continue;
    }

    // A single dot is field or module projection (`pair.fst`, `Lexer.read`).
    // `...` is already consumed above. Dot is not an identifier character,
    // so it stays a token even when glued to the names on either side.
    if (b === 0x2e) {
      bump();
      toks.push({
        kind: "punct",
        text: ".",
        span: { start, end: i },
        col: tokCol,
        indent: tokIndent,
        bol: tokBol,
        line: tokLine,
      });
      continue;
    }

    const punct = "(){}[],";
    if (punct.includes(String.fromCharCode(b))) {
      bump();
      toks.push({
        kind: "punct",
        text: String.fromCharCode(b),
        span: { start, end: i },
        col: tokCol,
        indent: tokIndent,
        bol: tokBol,
        line: tokLine,
      });
      continue;
    }

    const prev = start === 0 ? -1 : src[start - 1]!;
    const prevWs = prev === -1 || prev === 0x20 || prev === 0x09 || prev === 0x0a || prev === 0x0d;
    const prevIdent = isLetter(prev) || isIdentCont(prev) || prev === 0x21;
    if (!prevIdent && (b === 0x2d || b === 0x2b) && isDigit(peek(1))) {
      // signed number glued to the sign
    } else if (!prevIdent && b === 0x2d && (isLetter(peek(1)) || peek(1) === 0x28)) {
      bump();
      toks.push({
        kind: "op",
        text: "u-",
        span: { start, end: i },
        col: tokCol,
        indent: tokIndent,
        bol: tokBol,
        line: tokLine,
      });
      continue;
    }

    if (isDigit(b) || ((b === 0x2d || b === 0x2b) && isDigit(peek(1)) && !prevIdent)) {
      if (b === 0x2d || b === 0x2b) bump();
      let sawDot = false;
      let sawExp = false;
      let sawDigit = false;
      while (i < src.length) {
        const c = peek();
        if (isDigit(c)) {
          sawDigit = true;
          bump();
          continue;
        }
        if (c === 0x2e && !sawDot && !sawExp && peek(1) !== 0x2e) {
          sawDot = true;
          bump();
          continue;
        }
        if ((c === 0x65 || c === 0x45) && !sawExp && sawDigit) {
          sawExp = true;
          bump();
          if (peek() === 0x2d || peek() === 0x2b) bump();
          if (!isDigit(peek())) return err(start, i, "malformed float exponent");
          continue;
        }
        break;
      }
      const text = Buffer.from(src.subarray(start, i)).toString("utf8");
      toks.push({
        kind: sawDot || sawExp ? "float" : "int",
        text,
        span: { start, end: i },
        col: tokCol,
        indent: tokIndent,
        bol: tokBol,
        line: tokLine,
      });
      continue;
    }

    if (prevWs) {
      let matched = "";
      for (const op of OPS) {
        let ok = true;
        for (let k = 0; k < op.length; k++) {
          if (peek(k) !== op.charCodeAt(k)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const after = peek(op.length);
        const afterWs = after === -1 || after === 0x20 || after === 0x09 || after === 0x0a || after === 0x0d || after === 0x3b;
        if (!afterWs) continue;
        if (op.length > matched.length) matched = op;
      }
      if (matched.length > 0) {
        for (let k = 0; k < matched.length; k++) bump();
        toks.push({
          kind: "op",
          text: matched,
          span: { start, end: i },
          col: tokCol,
          indent: tokIndent,
          bol: tokBol,
          line: tokLine,
        });
        continue;
      }
    }

    if (isLetter(b) || b === 0x5f) {
      bump();
      while (isIdentCont(peek())) {
        if (peek() === 0x2d && peek(1) === 0x3e) {
          return err(i, i + 2, "operator -> requires whitespace on both sides");
        }
        bump();
      }
      if (peek() === 0x21) {
        const bangAt = i;
        bump();
        if (isIdentCont(peek()) || peek() === 0x21) {
          return err(start, i + 1, "'!' may appear only as the final character of an identifier");
        }
        void bangAt;
      }
      const text = Buffer.from(src.subarray(start, i)).toString("utf8");
      if (text.includes("!") && !text.endsWith("!")) {
        return err(start, i, "'!' may appear only as the final character of an identifier");
      }
      const kind: TokKind = text === "true" || text === "false" ? "ident" : KEYWORDS.has(text) ? "kw" : "ident";
      toks.push({
        kind,
        text,
        span: { start, end: i },
        col: tokCol,
        indent: tokIndent,
        bol: tokBol,
        line: tokLine,
      });
      continue;
    }

    return err(start, start + 1, `unexpected character`);
  }

  toks.push({
    kind: "eof",
    text: "",
    span: { start: src.length, end: src.length },
    col: 0,
    indent: 0,
    bol: true,
    line,
  });
  return { ok: true, toks };
}
