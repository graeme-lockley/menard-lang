/**
 * `menard fmt [--check] [--stdin] <file.mnd…>`
 * Rewrite via the reader printer with trivia preserved (TOOL-01).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { formatSource } from "../fmt/format.ts";
import { unifiedDiff } from "../fmt/diff.ts";

export type FmtCliArgs = {
  files: string[];
  check: boolean;
  stdin: boolean;
};

export function parseFmtArgs(args: string[]): FmtCliArgs | { error: string } {
  const files: string[] = [];
  let check = false;
  let stdin = false;
  for (const a of args) {
    if (a === "--check") {
      check = true;
      continue;
    }
    if (a === "--stdin") {
      stdin = true;
      continue;
    }
    if (a.startsWith("-")) return { error: `unknown option ${a}` };
    files.push(a);
  }
  if (stdin) {
    if (files.length > 0) return { error: "--stdin does not take file arguments" };
    return { files: [], check, stdin: true };
  }
  if (files.length === 0) return { error: "expected one or more .mnd files" };
  return { files, check, stdin: false };
}

function dec(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function checkOne(label: string, original: Uint8Array, formatted: Uint8Array): number {
  if (Buffer.from(original).equals(Buffer.from(formatted))) return 0;
  process.stderr.write(unifiedDiff(dec(original), dec(formatted), label));
  return 1;
}

export function runFmt(args: FmtCliArgs): number {
  if (args.stdin) {
    // Synchronous stdin read for CLI determinism.
    const buf = readFileSync(0);
    const original = new Uint8Array(buf);
    const result = formatSource(original);
    if (!result.ok) {
      const help = result.help ? ` (help: ${result.help})` : "";
      console.error(`error: <stdin>: ${result.message}${help}`);
      return 1;
    }
    if (args.check) return checkOne("<stdin>", original, result.bytes);
    process.stdout.write(result.bytes);
    return 0;
  }

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
    if (args.check) {
      const code = checkOne(file, bytes, result.bytes);
      if (code > status) status = code;
      continue;
    }
    if (!result.changed) continue;
    writeFileSync(file, result.bytes);
  }
  return status;
}
