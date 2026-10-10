/**
 * Host shortcuts for a few functions the stage0 compiler runs on every
 * byte or bit. Each one copies a specific Menard definition; if the
 * argument shape does not match, the caller falls back to the interpreter.
 *
 * Field projection is different: it is derived from the function body, so
 * it stays equivalent when a record accessor is only `(match (x) | Ctor(… f …) -> f)`.
 */

import type { Ast } from "../reader/ast.ts";
import { decodeSymBytes } from "./resolve.ts";
import type { Value } from "./value.ts";
import { vBool, vInt, vStr, vUnit } from "./value.ts";
import { mapGet, sbAppendByte, type StringBuffer } from "../builtins/collections.ts";

export type Accel = {
  impure: boolean;
} & (
  | { kind: "field"; ctor: string; index: number; arity: number }
  | { kind: "host"; id: HostId }
);

type HostId =
  | "not"
  | "lex-peek"
  | "lex-bump"
  | "is-letter"
  | "is-digit"
  | "is-ident-cont"
  | "is-keyword"
  | "is-none"
  | "match-op"
  | "op-len"
  | "bitsink-flush-fields"
  | "bitsink-write-fixed"
  | "bitsink-write-vbr-chunks"
  | "bitsink-write-vbr"
  | "int-list-length"
  | "line-search";

const accels = new WeakMap<object, Accel>();

export function setAccel(fn: object, accel: Accel): void {
  accels.set(fn, accel);
}

export function getAccel(fn: object): Accel | undefined {
  return accels.get(fn);
}

function symText(ast: Ast): string | null {
  if (ast.tag !== "sym") return null;
  return decodeSymBytes(ast.name);
}

function pathIs(path: string | undefined, suffix: string): boolean {
  return path === suffix || !!path?.endsWith("/" + suffix);
}

/** `(match param (Ctor _ f _) f)` with a single arm. */
function fieldAccel(params: string[], body: Ast[]): Accel | null {
  if (params.length !== 1 || body.length !== 1) return null;
  const form = body[0]!;
  if (form.tag !== "list" || form.elems.length !== 4) return null;
  const head = symText(form.elems[0]!);
  const scrut = symText(form.elems[1]!);
  const pat = form.elems[2]!;
  const result = symText(form.elems[3]!);
  if (head !== "match" || scrut !== params[0] || result === null) return null;
  if (pat.tag !== "list" || pat.elems.length < 2) return null;
  const ctor = symText(pat.elems[0]!);
  if (ctor === null) return null;
  let index = -1;
  for (let i = 1; i < pat.elems.length; i++) {
    const n = symText(pat.elems[i]!);
    if (n === null) return null;
    if (n === "_") continue;
    if (n !== result || index !== -1) return null;
    index = i - 1;
  }
  if (index < 0) return null;
  return { kind: "field", ctor, index, arity: pat.elems.length - 1, impure: false };
}

function hostAccel(path: string | undefined, name: string | undefined): Accel | null {
  if (!name) return null;
  if (pathIs(path, "stdlib/basics.mnd") && name === "not") {
    return { kind: "host", id: "not", impure: false };
  }
  if (pathIs(path, "src/reader/read.mnd")) {
    switch (name) {
      case "lex-peek":
        return { kind: "host", id: "lex-peek", impure: false };
      case "lex-bump":
        return { kind: "host", id: "lex-bump", impure: true };
      case "is-letter":
        return { kind: "host", id: "is-letter", impure: false };
      case "is-digit":
        return { kind: "host", id: "is-digit", impure: false };
      case "is-ident-cont":
        return { kind: "host", id: "is-ident-cont", impure: false };
      case "is-keyword":
        return { kind: "host", id: "is-keyword", impure: false };
      case "is-none":
        return { kind: "host", id: "is-none", impure: false };
      case "match-op":
        return { kind: "host", id: "match-op", impure: false };
      case "op-len":
        return { kind: "host", id: "op-len", impure: false };
      default:
        return null;
    }
  }
  if (pathIs(path, "src/emit/bc-writer.mnd")) {
    switch (name) {
      case "bitsink-flush-fields!":
        return { kind: "host", id: "bitsink-flush-fields", impure: true };
      case "bitsink-write-fixed!":
        return { kind: "host", id: "bitsink-write-fixed", impure: true };
      case "bitsink-write-vbr-chunks!":
        return { kind: "host", id: "bitsink-write-vbr-chunks", impure: true };
      case "bitsink-write-vbr!":
        return { kind: "host", id: "bitsink-write-vbr", impure: true };
      case "int-list-length":
        return { kind: "host", id: "int-list-length", impure: false };
      default:
        return null;
    }
  }
  if (pathIs(path, "src/modules/graph.mnd") && name === "line-search") {
    return { kind: "host", id: "line-search", impure: false };
  }
  return null;
}

export function accelFor(
  path: string | undefined,
  name: string | undefined,
  params: string[],
  body: Ast[],
): Accel | null {
  return fieldAccel(params, body) ?? hostAccel(path, name);
}

function i63(n: bigint): bigint {
  return BigInt.asIntN(63, n);
}

function asInt(v: Value | undefined): bigint | null {
  if (!v || v.tag !== "int") return null;
  return v.value;
}

function asRefInt(v: Value | undefined): { value: Value } | null {
  if (!v || v.tag !== "ref" || v.cell.value.tag !== "int") return null;
  return v.cell;
}

function asRecord(v: Value | undefined, name: string, arity: number): Value[] | null {
  if (!v || v.tag !== "record" || v.name !== name || v.fields.length !== arity) return null;
  return v.fields;
}

function byteAt(bytes: Uint8Array, i: bigint): number | null {
  if (i < 0n || i > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return bytes[Number(i)] ?? 0;
}

const KEYWORDS = new Set([
  "alias", "cond", "else", "extern", "fn", "if", "import", "let", "loop", "match",
  "panic", "pub", "record", "recur", "ref", "deref", "return", "set!",
  "type", "while", "when",
]);

function asciiOf(v: Value | undefined): string | null {
  if (!v || v.tag !== "str") return null;
  let s = "";
  for (let i = 0; i < v.bytes.length; i++) {
    const b = v.bytes[i]!;
    if (b > 127) return null;
    s += String.fromCharCode(b);
  }
  return s;
}

function isLetter(b: bigint): boolean {
  return (b >= 65n && b <= 90n) || (b >= 97n && b <= 122n);
}

function isDigit(b: bigint): boolean {
  return b >= 48n && b <= 57n;
}

function isIdentCont(b: bigint): boolean {
  return (
    isLetter(b) ||
    isDigit(b) ||
    b === 95n ||
    b === 45n ||
    b === 43n ||
    b === 42n ||
    b === 47n ||
    b === 37n ||
    b === 60n ||
    b === 62n ||
    b === 58n ||
    b === 64n
  );
}

/** `src/reader/read.mnd` `lex-peek`. */
function lexPeek(lx: Value | undefined, k: bigint): Value | null {
  const f = asRecord(lx, "Lex", 8);
  if (!f) return null;
  const src = f[0]!;
  const n = asInt(f[1]);
  const pos = asRefInt(f[2]);
  if (src.tag !== "str" || n === null || !pos) return null;
  const i = i63((pos.value as { tag: "int"; value: bigint }).value + k);
  if (i < n) {
    const b = byteAt(src.bytes, i);
    if (b === null) return null;
    return vInt(BigInt(b));
  }
  return vInt(-1n);
}

/** `src/reader/read.mnd` `lex-bump`. */
function lexBump(lx: Value | undefined): Value | null {
  const f = asRecord(lx, "Lex", 8);
  if (!f) return null;
  const src = f[0]!;
  const pos = asRefInt(f[2]);
  const line = asRefInt(f[3]);
  const col = asRefInt(f[4]);
  if (src.tag !== "str" || !pos || !line || !col) return null;
  const p = (pos.value as { tag: "int"; value: bigint }).value;
  const b = byteAt(src.bytes, p);
  if (b === null) return null;
  pos.value = vInt(i63(p + 1n));
  if (b === 10) {
    line.value = vInt(i63((line.value as { tag: "int"; value: bigint }).value + 1n));
    col.value = vInt(0n);
  } else {
    col.value = vInt(i63((col.value as { tag: "int"; value: bigint }).value + 1n));
  }
  return vInt(BigInt(b));
}

function afterWs(b: number): boolean {
  return b === -1 || b === 32 || b === 9 || b === 10 || b === 13 || b === 59;
}

/** `src/reader/read.mnd` `match-op`. */
function matchOp(lx: Value | undefined): Value | null {
  const f = asRecord(lx, "Lex", 8);
  if (!f) return null;
  const src = f[0]!;
  const n = asInt(f[1]);
  const pos = asRefInt(f[2]);
  if (src.tag !== "str" || n === null || !pos) return null;
  const i = (pos.value as { tag: "int"; value: bigint }).value;
  const b0v = lexPeek(lx, 0n);
  const b1v = lexPeek(lx, 1n);
  if (!b0v || b0v.tag !== "int" || !b1v || b1v.tag !== "int") return null;
  const b0 = Number(b0v.value);
  const b1 = Number(b1v.value);
  const third = byteAt(src.bytes, i + 2n);
  if (third === null && i + 2n < n) return null;
  const at2 = i + 2n < n ? (third ?? 0) : -1;
  if (b0 === 61 && b1 === 61 && afterWs(at2)) return opStr("==");
  if (b0 === 33 && b1 === 61 && afterWs(at2)) return opStr("!=");
  if (b0 === 60 && b1 === 61 && afterWs(at2)) return opStr("<=");
  if (b0 === 62 && b1 === 61 && afterWs(at2)) return opStr(">=");
  if (b0 === 38 && b1 === 38 && afterWs(at2)) return opStr("&&");
  if (b0 === 124 && b1 === 124 && afterWs(at2)) return opStr("||");
  if (b0 === 124 && b1 === 62 && afterWs(at2)) return opStr("|>");
  if (b0 === 45 && b1 === 62 && afterWs(at2)) return opStr("->");
  if (b0 === 58 && b1 === 58 && afterWs(at2)) return opStr("::");
  if (b0 === 43 && afterWs(b1)) return opStr("+");
  if (b0 === 45 && afterWs(b1)) return opStr("-");
  if (b0 === 42 && afterWs(b1)) return opStr("*");
  if (b0 === 47 && afterWs(b1)) return opStr("/");
  if (b0 === 37 && afterWs(b1)) return opStr("%");
  if (b0 === 60 && afterWs(b1)) return opStr("<");
  if (b0 === 62 && afterWs(b1)) return opStr(">");
  if (b0 === 61 && afterWs(b1)) return opStr("=");
  if (b0 === 124 && afterWs(b1)) return opStr("|");
  return opStr("");
}

const OP_STR = new Map<string, Value>();
function opStr(s: string): Value {
  let v = OP_STR.get(s);
  if (!v) {
    v = vStr(new TextEncoder().encode(s));
    OP_STR.set(s, v);
  }
  return v;
}

const POW2: bigint[] = (() => {
  const t: bigint[] = [];
  let a = 1n;
  for (let i = 0; i <= 62; i++) {
    t.push(a);
    a = BigInt.asIntN(63, a * 2n);
  }
  return t;
})();

type SinkParts = {
  buf: StringBuffer;
  pending: { value: Value };
  bits: { value: Value };
};

function sinkParts(s: Value | undefined): SinkParts | null {
  const f = asRecord(s, "BitSink", 3);
  if (!f) return null;
  const buf = f[0]!;
  const pending = asRefInt(f[1]);
  const bits = asRefInt(f[2]);
  if (buf.tag !== "sb" || !pending || !bits) return null;
  return { buf: buf.sb, pending, bits };
}

function pow2(n: bigint): bigint {
  if (n <= 0n) return 1n;
  if (n <= 62n) return POW2[Number(n)]!;
  let acc = 1n;
  for (let i = 0n; i < n; i++) acc = i63(acc * 2n);
  return acc;
}

/** `src/emit/bc-writer.mnd` `bitsink-flush-fields!`. */
function flushFields(buf: StringBuffer, pending: { value: Value }, bits: { value: Value }): void {
  let p = (pending.value as { tag: "int"; value: bigint }).value;
  let n = (bits.value as { tag: "int"; value: bigint }).value;
  while (n >= 8n) {
    sbAppendByte(buf, Number(i63(p % 256n)));
    p = i63(p / 256n);
    n = i63(n - 8n);
  }
  pending.value = vInt(p);
  bits.value = vInt(n);
}

/** `src/emit/bc-writer.mnd` `bitsink-write-fixed!`. Null only before any write. */
function writeFixed(s: Value | undefined, value: bigint, width: bigint): Value | null {
  const parts = sinkParts(s);
  if (!parts) return null;
  if (width === 0n) return vUnit();
  const shift = (parts.bits.value as { tag: "int"; value: bigint }).value;
  const p = (parts.pending.value as { tag: "int"; value: bigint }).value;
  const prod = i63(value * pow2(shift));
  parts.pending.value = vInt(i63(p + prod));
  parts.bits.value = vInt(i63(shift + width));
  flushFields(parts.buf, parts.pending, parts.bits);
  return vUnit();
}

/** `src/emit/bc-writer.mnd` `bitsink-write-vbr-chunks!`. */
function writeVbrChunks(s: Value | undefined, value: bigint, cont: bigint, width: bigint): Value | null {
  if (cont === 0n) return null;
  let v = value;
  for (;;) {
    const chunk = i63(v % cont);
    const rest = i63(v / cont);
    if (rest === 0n) return writeFixed(s, chunk, width);
    const wrote = writeFixed(s, i63(chunk + cont), width);
    if (wrote === null) return null;
    v = rest;
  }
}

/** `src/modules/graph.mnd` `line-search` / `line-search-mid`. */
function lineSearch(m: Value | undefined, lo: bigint, hi: bigint, offset: bigint): Value | null {
  if (!m || m.tag !== "map") return null;
  let a = lo;
  let b = hi;
  let guard = 0;
  while (a < b) {
    if (++guard > 64) return null;
    const mid = i63(i63(a + b) / 2n);
    const g = mapGet(m.map, vInt(mid));
    if (g === undefined) return vInt(a);
    if (g.tag !== "int") return null;
    if (g.value > offset) b = mid;
    else a = i63(mid + 1n);
  }
  return vInt(a);
}

function intListLength(xs: Value | undefined): Value | null {
  let n = 0n;
  let cur = xs;
  while (cur && cur.tag === "variant") {
    if (cur.ctor === "Nil" && cur.payloads.length === 0) return vInt(n);
    if (cur.ctor !== "Cons" || cur.payloads.length !== 2) return null;
    n = i63(n + 1n);
    cur = cur.payloads[1];
  }
  return null;
}

/** Null means the shape was not the one this shortcut handles. */
export function runAccel(accel: Accel, args: Value[]): Value | null {
  if (accel.kind === "field") {
    const a = args[0];
    if (args.length !== 1 || !a) return null;
    if (a.tag === "record" && a.name === accel.ctor && a.fields.length === accel.arity) {
      return a.fields[accel.index] ?? null;
    }
    if (a.tag === "variant" && a.ctor === accel.ctor && a.payloads.length === accel.arity) {
      return a.payloads[accel.index] ?? null;
    }
    return null;
  }
  switch (accel.id) {
    case "not": {
      const b = args[0];
      if (args.length !== 1 || !b || b.tag !== "bool") return null;
      return vBool(!b.value);
    }
    case "lex-peek": {
      if (args.length !== 2) return null;
      const k = asInt(args[1]);
      if (k === null) return null;
      return lexPeek(args[0], k);
    }
    case "lex-bump":
      if (args.length !== 1) return null;
      return lexBump(args[0]);
    case "is-letter": {
      if (args.length !== 1) return null;
      const b = asInt(args[0]);
      if (b === null) return null;
      return vBool(isLetter(b));
    }
    case "is-digit": {
      if (args.length !== 1) return null;
      const b = asInt(args[0]);
      if (b === null) return null;
      return vBool(isDigit(b));
    }
    case "is-ident-cont": {
      if (args.length !== 1) return null;
      const b = asInt(args[0]);
      if (b === null) return null;
      return vBool(isIdentCont(b));
    }
    case "is-keyword": {
      if (args.length !== 1 || !args[0] || args[0].tag !== "str") return null;
      const s = asciiOf(args[0]);
      if (s === null) return vBool(false);
      return vBool(KEYWORDS.has(s));
    }
    case "is-none": {
      const m = args[0];
      if (args.length !== 1 || !m || m.tag !== "variant") return null;
      if (m.ctor === "None" && m.payloads.length === 0) return vBool(true);
      if (m.ctor === "Some" && m.payloads.length === 1) return vBool(false);
      return null;
    }
    case "match-op":
      if (args.length !== 1) return null;
      return matchOp(args[0]);
    case "op-len": {
      if (args.length !== 1 || !args[0] || args[0].tag !== "str") return null;
      const s = asciiOf(args[0]);
      if (s === null) return vInt(1n);
      const two = s === "==" || s === "!=" || s === "<=" || s === ">=" || s === "&&" || s === "||" || s === "->" || s === "::" || s === "|>";
      return vInt(two ? 2n : 1n);
    }
    case "bitsink-flush-fields": {
      if (args.length !== 3) return null;
      const buf = args[0];
      const pending = asRefInt(args[1]);
      const bits = asRefInt(args[2]);
      if (!buf || buf.tag !== "sb" || !pending || !bits) return null;
      flushFields(buf.sb, pending, bits);
      return vUnit();
    }
    case "bitsink-write-fixed": {
      if (args.length !== 3) return null;
      const value = asInt(args[1]);
      const width = asInt(args[2]);
      if (value === null || width === null) return null;
      return writeFixed(args[0], value, width);
    }
    case "bitsink-write-vbr-chunks": {
      if (args.length !== 4) return null;
      const value = asInt(args[1]);
      const cont = asInt(args[2]);
      const width = asInt(args[3]);
      if (value === null || cont === null || width === null) return null;
      return writeVbrChunks(args[0], value, cont, width);
    }
    case "bitsink-write-vbr": {
      if (args.length !== 3) return null;
      const value = asInt(args[1]);
      const width = asInt(args[2]);
      if (value === null || width === null || width < 1n || width > 63n) return null;
      return writeVbrChunks(args[0], value, POW2[Number(width - 1n)]!, width);
    }
    case "int-list-length":
      if (args.length !== 1) return null;
      return intListLength(args[0]);
    case "line-search": {
      if (args.length !== 4) return null;
      const lo = asInt(args[1]);
      const hi = asInt(args[2]);
      const offset = asInt(args[3]);
      if (lo === null || hi === null || offset === null) return null;
      return lineSearch(args[0], lo, hi, offset);
    }
  }
}
