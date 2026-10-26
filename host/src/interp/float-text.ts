/**
 * Canonical Float text (LANG-02). Mirrors `mn_format_float` in
 * `runtime/src/float_text.c` by running the same C object code compiled to
 * WebAssembly (`float_text.wasm`), so the interpreter cannot drift from the
 * native reference via `String()` / `toPrecision()`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Exports = {
  memory: WebAssembly.Memory;
  mn_format_float: (d: number, buf: number, n: number) => number;
};

let exportsRef: Exports | null = null;

function load(): Exports {
  if (exportsRef !== null) return exportsRef;
  const wasmPath = join(dirname(fileURLToPath(import.meta.url)), "float_text.wasm");
  const bytes = readFileSync(wasmPath);
  const mod = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(mod, {});
  exportsRef = instance.exports as unknown as Exports;
  return exportsRef!;
}

/** Bit-exact Menard Float spelling for an IEEE-754 binary64 value. */
export function formatFloat(d: number): string {
  const ex = load();
  /* Scratch buffer in wasm linear memory; stays below the static data region. */
  const bufPtr = 1024;
  const n = ex.mn_format_float(d, bufPtr, 64);
  if (n < 0) throw new Error("mn_format_float failed");
  return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, bufPtr, n));
}
