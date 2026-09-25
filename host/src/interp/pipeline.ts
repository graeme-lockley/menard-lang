import type { Diagnostic } from "../diagnostic/diagnostic.ts";
import {
  parseErrorToDiagnostic,
  casingErrorToDiagnostic,
} from "../diagnostic/diagnostic.ts";
import { formatDiagnostics } from "../diagnostic/format.ts";
import { readAll, checkCasingAll } from "../reader/index.ts";
import { desugarAll } from "../desugar/index.ts";
import { typecheckForms, type ImportBundle } from "../type/check.ts";
import { evalProgram, type EvalResult } from "../interp/eval.ts";
import { showValue, type Value, envGet } from "../interp/index.ts";
import { createHost, type Host } from "../host/index.ts";
import type { Span } from "../reader/span.ts";
import { loadModuleGraph } from "./modules.ts";

export type PipelineOpts = {
  path?: string;
  host?: Host;
  /** Skip typechecking (not for production; tests only) */
  skipTypecheck?: boolean;
};

export type RunOk = { ok: true; value: Value; exitCode?: number };
export type RunErr = { ok: false; kind: "diagnostics"; diagnostics: Diagnostic[] };
export type RunPanic = {
  ok: false;
  kind: "panic";
  message: string;
  span?: Span;
};
export type RunResult = RunOk | RunErr | RunPanic;

const enc = new TextEncoder();

function toBytes(source: Uint8Array | string): Uint8Array {
  return typeof source === "string" ? enc.encode(source) : source;
}

/**
 * Diagnose source: parse → casing → desugar → type.
 * With `path` + `host`, loads the import graph through Host.
 * Never throws for user programs.
 */
export function diagnose(
  source: Uint8Array | string,
  opts: PipelineOpts = {},
): Diagnostic[] {
  const src = toBytes(source);
  if (opts.path && opts.host) {
    return diagnoseModules(src, opts.path, opts.host, opts.skipTypecheck);
  }
  return diagnoseSingle(src, opts.skipTypecheck);
}

function diagnoseSingle(src: Uint8Array, skipTypecheck?: boolean): Diagnostic[] {
  const parsed = readAll(src);
  if (!parsed.ok) {
    return [parseErrorToDiagnostic(parsed.error, codeForParse(parsed.error.message))];
  }

  const casing = checkCasingAll(parsed.forms);
  if (!casing.ok) {
    return [casingErrorToDiagnostic(casing.error)];
  }

  const desugared = desugarAll(parsed.forms);
  if (!desugared.ok) {
    return desugared.diagnostics;
  }

  if (skipTypecheck) return [];

  const typed = typecheckForms(desugared.forms);
  return typed.diagnostics;
}

function diagnoseModules(
  src: Uint8Array,
  path: string,
  host: Host,
  skipTypecheck?: boolean,
): Diagnostic[] {
  const loaded = loadModuleGraph(path, src, host);
  if (!loaded.ok) return loaded.diagnostics;
  if (skipTypecheck) return [];

  const bundles = new Map<string, ImportBundle>();
  const allDiags: Diagnostic[] = [];
  for (const p of loaded.graph.order) {
    const mod = loaded.graph.modules.get(p)!;
    const imports: ImportBundle[] = [];
    for (const imp of mod.imports) {
      const b = bundles.get(imp);
      if (b) imports.push(b);
    }
    const typed = typecheckForms(mod.forms, {
      imports,
      exports: mod.exports,
    });
    allDiags.push(...typed.diagnostics);
    bundles.set(p, typed.bundle);
  }
  return allDiags;
}

function codeForParse(message: string): string {
  if (message.includes("unclosed")) return "E_PARSE_UNCLOSED";
  if (message.includes("'!'")) return "E_PARSE_BANG";
  if (message.includes("unterminated")) return "E_PARSE_STRING";
  return "E_PARSE";
}

/**
 * Run source: diagnose first; on clean, evaluate.
 */
export function run(
  source: Uint8Array | string,
  opts: PipelineOpts = {},
): RunResult {
  const src = toBytes(source);
  const diags = diagnose(src, opts);
  if (diags.length > 0) {
    return { ok: false, kind: "diagnostics", diagnostics: diags };
  }

  const host = opts.host ?? createHost();

  if (opts.path) {
    return runModules(src, opts.path, host);
  }
  return runSingle(src, host);
}

function runSingle(src: Uint8Array, host: Host): RunResult {
  const parsed = readAll(src);
  if (!parsed.ok) {
    return {
      ok: false,
      kind: "diagnostics",
      diagnostics: [parseErrorToDiagnostic(parsed.error)],
    };
  }
  const desugared = desugarAll(parsed.forms);
  if (!desugared.ok) {
    return { ok: false, kind: "diagnostics", diagnostics: desugared.diagnostics };
  }

  const result: EvalResult = evalProgram(desugared.forms, host);
  if (!result.ok) {
    return {
      ok: false,
      kind: "panic",
      message: result.panic.message,
      span: result.panic.span,
    };
  }
  return { ok: true, value: result.value, exitCode: result.exitCode };
}

function runModules(src: Uint8Array, path: string, host: Host): RunResult {
  const loaded = loadModuleGraph(path, src, host);
  if (!loaded.ok) {
    return { ok: false, kind: "diagnostics", diagnostics: loaded.diagnostics };
  }

  const exportVals = new Map<string, Map<string, Value>>();
  let last: EvalResult | null = null;

  for (const p of loaded.graph.order) {
    const mod = loaded.graph.modules.get(p)!;
    const importBindings = new Map<string, Value>();
    for (const imp of mod.imports) {
      const ex = exportVals.get(imp);
      if (ex) {
        for (const [k, v] of ex) importBindings.set(k, v);
      }
    }
    const result = evalProgram(mod.forms, host, { importBindings });
    if (!result.ok) {
      return {
        ok: false,
        kind: "panic",
        message: result.panic.message,
        span: result.panic.span,
      };
    }
    const exported = new Map<string, Value>();
    for (const name of mod.exports) {
      const v = envGet(result.env, name);
      if (v) exported.set(name, v);
    }
    exportVals.set(p, exported);
    last = result;
  }

  if (!last || !last.ok) {
    return { ok: true, value: { tag: "unit" } };
  }
  return { ok: true, value: last.value, exitCode: last.exitCode };
}

export function formatRunErrors(
  result: RunErr | RunPanic,
  source: Uint8Array | string,
  path = "<input>",
): string {
  if (result.kind === "diagnostics") {
    return formatDiagnostics(result.diagnostics, source, path);
  }
  const span = result.span ?? { start: 0, end: 0 };
  return formatDiagnostics(
    [
      {
        severity: "error",
        category: "semantic",
        code: "E_PANIC",
        message: result.message,
        span,
      },
    ],
    source,
    path,
  );
}

export { showValue, formatDiagnostics };
