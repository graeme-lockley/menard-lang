#!/usr/bin/env bun
/**
 * Thin Menard check/run CLI (Phase 1 host).
 * Exit: 0 ok, 1 program error/panic, 2 interpreter fault
 */
import { readFileSync } from "node:fs";
import { diagnose, run, formatRunErrors, showValue } from "../interp/index.ts";
import { formatDiagnostics } from "../diagnostic/index.ts";
import { createHost } from "../host/index.ts";

function usage(): never {
  console.error("usage: menard <check|run> <file.mnd>");
  process.exit(2);
}

const [, , cmd, file] = process.argv;
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

// run
const host = createHost();
const result = run(source, { path, host });
if (result.ok) {
  if (result.value.tag !== "unit") {
    process.stdout.write(showValue(result.value) + "\n");
  }
  for (const chunk of host.stdout) process.stdout.write(chunk);
  for (const chunk of host.stderr) process.stderr.write(chunk);
  process.exit(0);
}

if (result.kind === "diagnostics" || result.kind === "panic") {
  process.stderr.write(formatRunErrors(result, source, path));
  for (const chunk of host.stderr) process.stderr.write(chunk);
  process.exit(1);
}

process.exit(2);
