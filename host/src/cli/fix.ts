/**
 * `menard fix [--dry-run] [--rule name] <file.mnd…>`
 * LANG-07 ships the `nullary-ctor` rule; further rules land with TOOL-12.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fixNullaryCtor, type NullaryRewrite } from "../fix/nullary-ctor.ts";

export type FixCliArgs = {
  dryRun: boolean;
  rule: string | null;
  files: string[];
};

export function parseFixArgs(args: string[]): FixCliArgs | { error: string } {
  let dryRun = false;
  let rule: string | null = null;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--rule") {
      const next = args[++i];
      if (!next) return { error: "--rule requires a name" };
      rule = next;
      continue;
    }
    if (a.startsWith("-")) return { error: `unknown option ${a}` };
    files.push(a);
  }
  if (files.length === 0) return { error: "expected one or more .mnd files" };
  return { dryRun, rule, files };
}

const KNOWN_RULES = new Set(["nullary-ctor"]);

export function runFix(args: FixCliArgs): number {
  if (args.rule !== null && !KNOWN_RULES.has(args.rule)) {
    console.error(`error: unknown rule ${args.rule}`);
    return 2;
  }
  // Default and only rule today.
  const rule = args.rule ?? "nullary-ctor";
  if (rule !== "nullary-ctor") {
    console.error(`error: unknown rule ${rule}`);
    return 2;
  }

  let status = 0;
  for (const file of args.files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (e) {
      console.error(`error: cannot read ${file}: ${e}`);
      status = 1;
      continue;
    }
    const result = fixNullaryCtor(text);
    if (!result.ok) {
      console.error(`error: ${file}: ${result.error}`);
      status = 1;
      continue;
    }
    if (!result.changed) continue;
    reportRewrites(file, result.rewrites);
    if (!args.dryRun) {
      writeFileSync(file, result.source);
    }
  }
  return status;
}

function reportRewrites(file: string, rewrites: NullaryRewrite[]): void {
  // Rewrites are stored right-to-left; print left-to-right for humans.
  const ordered = [...rewrites].sort((a, b) => a.start - b.start);
  for (const r of ordered) {
    console.log(`${file}: ${r.name}() -> ${r.name}`);
  }
}
