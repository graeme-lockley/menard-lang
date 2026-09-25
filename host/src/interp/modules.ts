import type { Ast } from "../reader/ast.ts";
import { nameEquals } from "../reader/ast.ts";
import type { Diagnostic } from "../diagnostic/diagnostic.ts";
import {
  diagnostic,
  parseErrorToDiagnostic,
  casingErrorToDiagnostic,
} from "../diagnostic/diagnostic.ts";
import { readAll, checkCasingAll } from "../reader/index.ts";
import { desugarAll } from "../desugar/index.ts";
import type { Host } from "../host/host.ts";
import type { Span } from "../reader/span.ts";

const SEAM_SUFFIXES = [
  "/stdlib/sys.mnd",
  "/stdlib/io.mnd",
  "/stdlib/fs.mnd",
  "/stdlib/proc.mnd",
  "/sys.mnd",
  "/io.mnd",
  "/fs.mnd",
  "/proc.mnd",
];

export function isSeamModule(path: string): boolean {
  const p = path.startsWith("/") ? path : "/" + path;
  return SEAM_SUFFIXES.some((s) => p === s || p.endsWith(s));
}

/** Resolve import spec relative to the importing module path (no absolute canonicalisation). */
export function resolveImportPath(fromPath: string, spec: string): string {
  if (spec.startsWith("/")) return normalizeRel(spec);
  const fromDir = dirname(fromPath);
  const joined =
    fromDir === "." || fromDir === "" ? spec : `${fromDir}/${spec}`;
  return normalizeRel(joined);
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return path.slice(0, i);
}

function normalizeRel(path: string): string {
  const abs = path.startsWith("/");
  const parts = path.split("/").filter((p) => p && p !== ".");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") {
      if (out.length) out.pop();
    } else out.push(p);
  }
  const s = out.join("/");
  if (abs) return "/" + s;
  return s || ".";
}

export type PreparedModule = {
  path: string;
  forms: Ast[];
  exports: Set<string>;
  imports: string[];
};

export type ModuleGraph = {
  order: string[];
  modules: Map<string, PreparedModule>;
};

export type LoadResult =
  | { ok: true; graph: ModuleGraph }
  | { ok: false; diagnostics: Diagnostic[] };

type RawModule = {
  path: string;
  forms: Ast[];
  exports: Set<string>;
  imports: { path: string; span: Span }[];
};

/**
 * Load the entry module and its import closure through Host.
 */
export function loadModuleGraph(
  entryPath: string,
  entrySource: Uint8Array,
  host: Host,
): LoadResult {
  const diagnostics: Diagnostic[] = [];
  const raw = new Map<string, RawModule>();

  function readModule(path: string, source: Uint8Array): void {
    if (raw.has(path)) return;

    const parsed = readAll(source);
    if (!parsed.ok) {
      diagnostics.push(parseErrorToDiagnostic(parsed.error));
      raw.set(path, { path, forms: [], exports: new Set(), imports: [] });
      return;
    }
    const casing = checkCasingAll(parsed.forms);
    if (!casing.ok) {
      diagnostics.push(casingErrorToDiagnostic(casing.error));
      raw.set(path, { path, forms: [], exports: new Set(), imports: [] });
      return;
    }
    const desugared = desugarAll(parsed.forms);
    if (!desugared.ok) {
      diagnostics.push(...desugared.diagnostics);
      raw.set(path, { path, forms: [], exports: new Set(), imports: [] });
      return;
    }

    const imports: { path: string; span: Span }[] = [];
    const exports = new Set<string>();
    const body: Ast[] = [];

    for (const form of desugared.forms) {
      const imp = parseImport(form);
      if (imp) {
        if (!imp.spec) {
          diagnostics.push(
            diagnostic({
              severity: "error",
              category: "semantic",
              code: "E_IMPORT",
              message: "import path must be a string",
              span: imp.span,
            }),
          );
          continue;
        }
        const resolved = resolveImportPath(path, imp.spec);
        imports.push({ path: resolved, span: imp.span });
        continue;
      }

      const pub = unwrapPub(form);
      if (pub.exported) {
        for (const n of declarationNames(pub.form)) exports.add(n);
      }
      if (isExtern(pub.form) && !isSeamModule(path)) {
        diagnostics.push(
          diagnostic({
            severity: "error",
            category: "semantic",
            code: "E_EXTERN_SEAM",
            message:
              "extern is confined to stdlib seam modules (sys, io, fs, proc)",
            span: pub.form.span,
          }),
        );
      }
      body.push(pub.form);
    }

    raw.set(path, { path, forms: body, exports, imports });

    for (const imp of imports) {
      if (raw.has(imp.path)) continue;
      const file = host.readFile(imp.path);
      if (!file.ok) {
        diagnostics.push(
          diagnostic({
            severity: "error",
            category: "semantic",
            code: "E_IMPORT_MISSING",
            message: `module not found: ${imp.path}`,
            span: imp.span,
          }),
        );
        continue;
      }
      readModule(imp.path, file.bytes);
    }
  }

  const entry = entryPath;
  readModule(entry, entrySource);

  if (diagnostics.some((d) => d.code !== "E_EXTERN_SEAM" && d.code !== "E_PUB_PRIVATE_TYPE")) {
    // Keep going for seam errors only after graph is built; missing/parse stop us
  }
  if (diagnostics.some((d) =>
    d.code === "E_IMPORT_MISSING" ||
    d.code === "E_PARSE" ||
    d.code.startsWith("E_PARSE") ||
    d.code === "E_CASING" ||
    d.code === "E_IMPORT"
  )) {
    return { ok: false, diagnostics };
  }

  // Cycle detection
  const color = new Map<string, "gray" | "black">();
  const stack: string[] = [];
  function dfsCycle(p: string): boolean {
    color.set(p, "gray");
    stack.push(p);
    const m = raw.get(p);
    if (m) {
      for (const imp of m.imports) {
        const c = color.get(imp.path);
        if (c === "gray") {
          const i = stack.indexOf(imp.path);
          const cycle = [...stack.slice(i), imp.path].join(" -> ");
          diagnostics.push(
            diagnostic({
              severity: "error",
              category: "semantic",
              code: "E_IMPORT_CYCLE",
              message: `import cycle: ${cycle}`,
              span: imp.span,
            }),
          );
          return true;
        }
        if (c !== "black" && raw.has(imp.path)) {
          if (dfsCycle(imp.path)) return true;
        }
      }
    }
    stack.pop();
    color.set(p, "black");
    return false;
  }
  for (const p of raw.keys()) {
    if (!color.has(p) && dfsCycle(p)) break;
  }
  if (diagnostics.some((d) => d.code === "E_IMPORT_CYCLE")) {
    return { ok: false, diagnostics };
  }

  // Topological order: deps before dependents; ties by path
  const order: string[] = [];
  const seen = new Set<string>();
  function topo(p: string): void {
    if (seen.has(p)) return;
    seen.add(p);
    const m = raw.get(p);
    if (m) {
      const deps = m.imports.map((i) => i.path).filter((d) => raw.has(d));
      deps.sort();
      for (const d of deps) topo(d);
    }
    order.push(p);
  }
  const roots = [...raw.keys()].sort();
  for (const p of roots) topo(p);

  // Prefer entry last among those that import others — actually topo already puts deps first
  // Ensure entry is in order (it should be)
  if (!seen.has(entry)) order.push(entry);

  const modules = new Map<string, PreparedModule>();
  for (const p of order) {
    const m = raw.get(p)!;
    modules.set(p, {
      path: p,
      forms: m.forms,
      exports: m.exports,
      imports: m.imports.map((i) => i.path),
    });
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, graph: { order, modules } };
}

function parseImport(form: Ast): { spec: string; span: Span } | null {
  if (form.tag !== "list" || form.elems.length < 2) return null;
  const h = form.elems[0]!;
  if (h.tag !== "sym" || !nameEquals(h.name, "import")) return null;
  const spec = form.elems[1]!;
  if (spec.tag !== "str") return { spec: "", span: form.span };
  return { spec: new TextDecoder().decode(spec.bytes), span: form.span };
}

function unwrapPub(form: Ast): { form: Ast; exported: boolean } {
  if (form.tag !== "list" || form.elems.length < 2) {
    return { form, exported: false };
  }
  const h = form.elems[0]!;
  if (h.tag !== "sym" || !nameEquals(h.name, "pub")) {
    return { form, exported: false };
  }
  const inner: Ast = {
    tag: "list",
    kind: form.kind,
    elems: form.elems.slice(1),
    span: form.span,
  };
  return { form: inner, exported: true };
}

function isExtern(form: Ast): boolean {
  if (form.tag !== "list" || form.elems.length === 0) return false;
  const h = form.elems[0]!;
  return h.tag === "sym" && nameEquals(h.name, "extern");
}

export function declarationNames(form: Ast): string[] {
  if (form.tag !== "list" || form.elems.length < 2) return [];
  const h = form.elems[0]!;
  if (h.tag !== "sym") return [];
  const hn = new TextDecoder().decode(h.name);
  if (hn === "defn" || hn === "defrec" || hn === "alias" || hn === "extern") {
    const namePart = form.elems[1]!;
    if (namePart.tag === "sym") return [new TextDecoder().decode(namePart.name)];
    if (namePart.tag === "list" && namePart.elems[0]?.tag === "sym") {
      return [new TextDecoder().decode(namePart.elems[0].name)];
    }
  }
  if (hn === "variant") {
    const names: string[] = [];
    const namePart = form.elems[1]!;
    if (namePart.tag === "sym") names.push(new TextDecoder().decode(namePart.name));
    else if (namePart.tag === "list" && namePart.elems[0]?.tag === "sym") {
      names.push(new TextDecoder().decode(namePart.elems[0].name));
    }
    for (let i = 2; i < form.elems.length; i++) {
      const ce = form.elems[i]!;
      if (ce.tag === "list" && ce.elems[0]?.tag === "sym") {
        names.push(new TextDecoder().decode(ce.elems[0].name));
      }
    }
    return names;
  }
  return [];
}
