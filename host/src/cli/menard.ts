#!/usr/bin/env bun
/**
 * Thin Menard check/run/fix CLI (Phase 1 host).
 * Exit: 0 ok, 1 program error/panic, 2 interpreter fault / usage
 * `(exit n)` ends the program with status `n & 0xff`.
 * Otherwise an `Int` returned from `main` is that status, as in the native binary.
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
import { parseFixArgs, runFix } from "./fix.ts";

function usage(): never {
  console.error(
    "usage: menard <check|run> [--show-result] <file.mnd> [-- arg…]\n" +
      "       menard fix [--dry-run] [--rule name] <file.mnd…>",
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv[0] === "fix") {
  const parsed = parseFixArgs(argv.slice(1));
  if ("error" in parsed) {
    console.error(`error: ${parsed.error}`);
    usage();
  }
  process.exit(runFix(parsed));
}

const showStack = process.env.MENARD_STACK === "1";
const parsed = parseCliArgs(argv);
if (!parsed) usage();
const { cmd, file, showResult, argv: progArgv } = parsed;

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
    const host = createLiveHost({ realFs: true, argv: progArgv, spawnEnabled: true });

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
      const fromMain =
        result.exitCode === undefined && result.value.tag === "int"
          ? Number(BigInt.asUintN(8, result.value.value))
          : 0;
      process.exit(result.exitCode ?? fromMain);
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
