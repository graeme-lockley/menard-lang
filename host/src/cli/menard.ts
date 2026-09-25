#!/usr/bin/env bun
/**
 * Thin Menard check/run CLI (Phase 1 host).
 * Exit: 0 ok, 1 program error/panic, 2 interpreter fault
 * `(exit n)` ends the program with status `n & 0xff`.
 *
 * print/println/dump write live to process streams during evaluation.
 * Pass --show-result to also print the final non-Unit value (REPL-style).
 * Pass program args after `--`: `menard run main.mnd -- arg1 arg2`
 * Set MENARD_STACK=1 to include a stack trace on internal faults.
 */
import { readFileSync } from "node:fs";
import { diagnose, run, formatRunErrors, showValue } from "../interp/index.ts";
import { formatDiagnostics } from "../diagnostic/index.ts";
import { createLiveHost } from "../host/index.ts";
import { withInternalGuard } from "./guard.ts";
import { parseCliArgs } from "./args.ts";

function usage(): never {
  console.error("usage: menard <check|run> [--show-result] <file.mnd> [-- arg…]");
  process.exit(2);
}

const showStack = process.env.MENARD_STACK === "1";
const parsed = parseCliArgs(process.argv.slice(2));
if (!parsed) usage();
const { cmd, file, showResult, argv } = parsed;

withInternalGuard(
  () => {
    let source: Uint8Array;
    try {
      source = new Uint8Array(readFileSync(file));
    } catch (e) {
      console.error(`error: cannot read ${file}: ${e}`);
      process.exit(2);
    }

    const path = file;
    const host = createLiveHost({ realFs: true, argv });

    if (cmd === "check") {
      const diags = diagnose(source, { path, host });
      if (diags.length === 0) {
        process.exit(0);
      }
      process.stderr.write(formatDiagnostics(diags, source, path));
      process.exit(1);
    }

    const result = run(source, { path, host });
    if (result.ok) {
      if (showResult && result.exitCode === undefined && result.value.tag !== "unit") {
        process.stdout.write(showValue(result.value) + "\n");
      }
      process.exit(result.exitCode ?? 0);
    }

    if (result.kind === "diagnostics" || result.kind === "panic") {
      process.stderr.write(formatRunErrors(result, source, path));
      process.exit(1);
    }

    process.exit(2);
  },
  {
    writeStderr: (s) => process.stderr.write(s),
    exit: (c) => process.exit(c),
    showStack,
  },
);
