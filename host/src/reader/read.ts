import { parseExpression, parseProgram } from "./parse.ts";

export type ParseError = { span: { start: number; end: number }; message: string };
export type ReadOk = { ok: true; ast: import("./ast.ts").Ast };
export type ReadErr = { ok: false; error: ParseError };
export type ReadResult = ReadOk | ReadErr;
export type ReadAllOk = { ok: true; forms: import("./ast.ts").Ast[] };
export type ReadAllResult = ReadAllOk | ReadErr;

const enc = new TextEncoder();

function bytes(source: Uint8Array | string): Uint8Array {
  return typeof source === "string" ? enc.encode(source) : source;
}

/** Read a single expression. Trailing junk is an error. */
export function read(source: Uint8Array | string): ReadResult {
  return parseExpression(bytes(source));
}

/** Read a file of top-level declarations. */
export function readAll(source: Uint8Array | string): ReadAllResult {
  return parseProgram(bytes(source));
}
