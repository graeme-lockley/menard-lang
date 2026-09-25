#!/usr/bin/env bun
/**
 * Thin Menard check/run CLI (Phase 1 host).
 * Exit: 0 ok, 1 program error/panic, 2 interpreter fault
 *
 * print/println/dump write live to process streams during evaluation.
 * Pass --show-result to also print the final non-Unit value (REPL-style).
 */
import { readFileSync } from "node:fs";
import { diagnose, run, formatRunErrors, showValue } from "../interp/index.ts";
import { formatDiagnostics } from "../diagnostic/index.ts";
import { createLiveHost } from "../host/index.ts";

function usage(): never {
  console.error("usage: menard <check|run> [--show-result] <file.mnd>");
  process.exit(2);
}

const args = process.argv.slice(2);
const showResult = args.includes("--show-result");
const positional = args.filter((a) => a !== "--show-result");
const [cmd, file] = positional;
if (!cmd || !file || (cmd !== "check" && cmd !== "run")) usage();

let source: Uint8Array;
try {
  source = new Uint8Array(readFileSync(file));
} catch (e) {
  console.error(`error: cannot read ${file}: ${e}`);
  process.exit(2);
}

const path = file;

if (cmd === "check") {
  const diags = diagnose(source, { path });
  if (diags.length === 0) {
    process.exit(0);
  }
  process.stderr.write(formatDiagnostics(diags, source, path));
  process.exit(1);
}

// run — live host so print/println appear as they execute
const host = createLiveHost();
const result = run(source, { path, host });
if (result.ok) {
  if (showResult && result.value.tag !== "unit") {
    process.stdout.write(showValue(result.value) + "\n");
  }
  process.exit(0);
}

if (result.kind === "diagnostics" || result.kind === "panic") {
  process.stderr.write(formatRunErrors(result, source, path));
  process.exit(1);
}

process.exit(2);
