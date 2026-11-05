/**
 * `menard fmt <file.mnd…>`
 * LANG-09 AC7 / TOOL-01 slice: rewrite via the reader printer.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { formatSource } from "../fmt/format.ts";

export type FmtCliArgs = {
  files: string[];
};

export function parseFmtArgs(args: string[]): FmtCliArgs | { error: string } {
  const files: string[] = [];
  for (const a of args) {
    if (a.startsWith("-")) return { error: `unknown option ${a}` };
    files.push(a);
  }
  if (files.length === 0) return { error: "expected one or more .mnd files" };
  return { files };
}

export function runFmt(args: FmtCliArgs): number {
  let status = 0;
  for (const file of args.files) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(file));
    } catch (e) {
      console.error(`error: cannot read ${file}: ${e}`);
      status = 1;
      continue;
    }
    const result = formatSource(bytes);
    if (!result.ok) {
      const help = result.help ? ` (help: ${result.help})` : "";
      console.error(`error: ${file}: ${result.message}${help}`);
      status = 1;
      continue;
    }
    if (!result.changed) continue;
    writeFileSync(file, result.bytes);
  }
  return status;
}
