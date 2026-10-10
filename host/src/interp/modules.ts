import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
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
import { packRest, restExportSigs } from "../desugar/rest.ts";
import type { Host } from "../host/host.ts";
import type { Span } from "../reader/span.ts";
import {
  decodeBytes,
  ensureGithubTree,
  isBasicsPath,
  isBasicsSpec,
  noteGithubVersion,
  parseGithubSpec,
  resolveImportPath,
  versionClashMessage,
} from "./imports.ts";

export { resolveImportPath } from "./imports.ts";

const moduleDir = nodePath.dirname(fileURLToPath(import.meta.url));

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

const RUNTIME_SUFFIXES = [
  "/stdlib/string.mnd",
  "/stdlib/map.mnd",
  "/stdlib/string-buffer.mnd",
];

export function isSeamModule(path: string): boolean {
  const p = path.startsWith("/") ? path : "/" + path;
  return SEAM_SUFFIXES.some((s) => p === s || p.endsWith(s));
}

export function isRuntimeModule(path: string): boolean {
  const p = path.startsWith("/") ? path : "/" + path;
  return RUNTIME_SUFFIXES.some((s) => p.endsWith(s));
}

export type PreparedModule = {
  path: string;
  forms: Ast[];
  exports: Set<string>;
  imports: { path: string; alias?: string }[];
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
  imports: { path: string; spec: string; span: Span; alias?: string }[];
  /** Import paths whose exports are also exports of this module. */
  reexports: string[];
};

/**
 * Load the entry module and its import closure through Host.
 */
function readModuleBytes(
  host: Host,
  path: string,
): { ok: true; bytes: Uint8Array } | { ok: false } {
  const file = host.readFile(path);
  if (file.ok) return file;
  // `std/…` resolves to a cwd-relative `stdlib/…` path. A virtual host does
  // not contain the shipped library, so fall back to the real tree.
  if (path.startsWith("stdlib/")) {
    const roots = [
      process.cwd(),
      nodePath.resolve(moduleDir, "../../.."),
    ];
    for (const root of roots) {
      try {
        return {
          ok: true,
          bytes: new Uint8Array(nodeFs.readFileSync(nodePath.join(root, path))),
        };
      } catch {
        // try the next root
      }
    }
  }
  return { ok: false };
}

function isSymNamed(ast: Ast, name: string): boolean {
  return ast.tag === "sym" && nameEquals(ast.name, name);
}

function isStringConcatHead(head: Ast, bare: boolean, aliases: Set<string>): boolean {
  if (head.tag === "sym") return bare && nameEquals(head.name, "concat");
  if (head.tag !== "list" || head.elems.length !== 3) return false;
  const proj = head.elems[0]!;
  const target = head.elems[1]!;
  const field = head.elems[2]!;
  if (!isSymNamed(proj, "project") || target.tag !== "sym" || !isSymNamed(field, "concat")) return false;
  for (const alias of aliases) {
    if (nameEquals(target.name, alias)) return true;
  }
  return false;
}

function foldConcatCall(head: Ast, args: Ast[], span: Ast["span"]): Ast {
  if (args.length === 1) return args[0]!;
  if (args.length < 2) return { tag: "list", kind: "paren", elems: [head, ...args], span };
  let acc = args[0]!;
  for (let i = 1; i < args.length; i++) {
    acc = { tag: "list", kind: "paren", elems: [head, acc, args[i]!], span };
  }
  return acc;
}

function foldConcatAst(ast: Ast, bare: boolean, aliases: Set<string>): Ast {
  if (ast.tag !== "list") return ast;
  if (ast.elems.length > 0 && isSymNamed(ast.elems[0]!, "quote")) return ast;
  const elems = ast.elems.map((e) => foldConcatAst(e, bare, aliases));
  const head = elems[0];
  if (head && isStringConcatHead(head, bare, aliases) && elems.length !== 3) {
    return foldConcatCall(head, elems.slice(1), ast.span);
  }
  return { ...ast, elems };
}

/** Left-fold n-ary `concat` once it is known to be `std/string`'s. */
function foldStringConcat(
  forms: Ast[],
  path: string,
  imports: { path: string; alias?: string }[],
): Ast[] {
  const fromString = (p: string) => {
    const n = p.startsWith("/") ? p : "/" + p;
    return n.endsWith("/stdlib/string.mnd");
  };
  const bare = fromString(path) || imports.some((imp) => !imp.alias && fromString(imp.path));
  const aliases = new Set(
    imports.filter((imp) => imp.alias && fromString(imp.path)).map((imp) => imp.alias!),
  );
  if (!bare && aliases.size === 0) return forms;
  return forms.map((f) => foldConcatAst(f, bare, aliases));
}

export function loadModuleGraph(
  entryPath: string,
  entrySource: Uint8Array,
  host: Host,
): LoadResult {
  const diagnostics: Diagnostic[] = [];
  const raw = new Map<string, RawModule>();
  const versions = new Map<string, string>();
  const home = host.getenv("HOME");

  function readModule(path: string, source: Uint8Array): void {
    if (raw.has(path)) return;

    const parsed = readAll(source);
    if (!parsed.ok) {
      diagnostics.push(parseErrorToDiagnostic(parsed.error));
      raw.set(path, { path, forms: [], exports: new Set(), imports: [], reexports: [] });
      return;
    }
    const casing = checkCasingAll(parsed.forms);
    if (!casing.ok) {
      diagnostics.push(casingErrorToDiagnostic(casing.error));
      raw.set(path, { path, forms: [], exports: new Set(), imports: [], reexports: [] });
      return;
    }
    const desugared = desugarAll(parsed.forms);
    if (!desugared.ok) {
      diagnostics.push(...desugared.diagnostics);
      raw.set(path, { path, forms: [], exports: new Set(), imports: [], reexports: [] });
      return;
    }

    const imports: { path: string; spec: string; span: Span; alias?: string }[] = [];
    const reexports: string[] = [];
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
              message: "import path must be a string or a name",
              span: imp.span,
            }),
          );
          continue;
        }
        const clash = noteGithubVersion(versions, imp.spec);
        if (clash) {
          diagnostics.push(
            diagnostic({
              severity: "error",
              category: "semantic",
              code: "E_IMPORT_VERSION",
              message: versionClashMessage(clash),
              span: imp.span,
            }),
          );
          continue;
        }
        const resolved = resolveImportPath(path, imp.spec, home);
        imports.push({ path: resolved, spec: imp.spec, span: imp.span, alias: imp.alias });
        if (imp.reexport) reexports.push(resolved);
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
      if (isRuntime(pub.form) && !isRuntimeModule(path)) {
        diagnostics.push(
          diagnostic({
            severity: "error",
            category: "semantic",
            code: "E_RUNTIME_MODULE",
            message:
              "runtime is confined to stdlib string, map, and string-buffer",
            span: pub.form.span,
          }),
        );
      }
      body.push(pub.form);
    }

    if (!isBasicsPath(path) && !imports.some((imp) => isBasicsSpec(imp.spec) || isBasicsPath(imp.path))) {
      imports.unshift({
        path: resolveImportPath(path, "std/basics", home),
        spec: "std/basics",
        span: { start: 0, end: 0 },
      });
    }

    raw.set(path, { path, forms: body, exports, imports, reexports });

    for (const imp of imports) {
      if (raw.has(imp.path)) continue;
      const gh = parseGithubSpec(imp.spec);
      if (gh && !host.exists(imp.path)) {
        const ensured = ensureGithubTree(gh, home);
        if (!ensured.ok) {
          diagnostics.push(
            diagnostic({
              severity: "error",
              category: "semantic",
              code: "E_IMPORT_MISSING",
              message: ensured.message,
              span: imp.span,
            }),
          );
          continue;
        }
      }
      const file = readModuleBytes(host, imp.path);
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
    d.code === "E_IMPORT" ||
    d.code === "E_IMPORT_VERSION"
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

  let grew = true;
  while (grew) {
    grew = false;
    for (const m of raw.values()) {
      for (const depPath of m.reexports) {
        const dep = raw.get(depPath);
        if (!dep) continue;
        for (const name of dep.exports) {
          if (!m.exports.has(name)) {
            m.exports.add(name);
            grew = true;
          }
        }
      }
    }
  }

  const restExports = new Map<string, Map<string, number>>();
  for (const m of raw.values()) {
    restExports.set(m.path, restExportSigs(m.forms, m.exports));
  }
  let restGrew = true;
  while (restGrew) {
    restGrew = false;
    for (const m of raw.values()) {
      const mine = restExports.get(m.path)!;
      for (const depPath of m.reexports) {
        const dep = restExports.get(depPath);
        if (!dep) continue;
        for (const [name, fixed] of dep) {
          if (m.exports.has(name) && !mine.has(name)) {
            mine.set(name, fixed);
            restGrew = true;
          }
        }
      }
    }
  }
  for (const m of raw.values()) {
    const imported = new Map<string, number>();
    const blocked = new Set<string>();
    for (const imp of m.imports) {
      if (imp.alias) continue;
      const sigs = restExports.get(imp.path);
      if (sigs) {
        for (const [name, fixed] of sigs) imported.set(name, fixed);
      }
      const dep = raw.get(imp.path);
      if (dep) {
        for (const name of dep.exports) blocked.add(name);
      }
    }
    const packed = packRest(m.forms, imported, blocked);
    m.forms = foldStringConcat(packed.forms, m.path, m.imports);
    if (!packed.ok) diagnostics.push(...packed.diagnostics);
  }

  const modules = new Map<string, PreparedModule>();
  for (const p of order) {
    const m = raw.get(p)!;
    modules.set(p, {
      path: p,
      forms: m.forms,
      exports: m.exports,
      imports: m.imports.map((i) => ({ path: i.path, alias: i.alias })),
    });
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, graph: { order, modules } };
}

function parseImport(
  form: Ast,
): { spec: string; span: Span; reexport: boolean; alias?: string } | null {
  let node = form;
  let reexport = false;
  if (node.tag === "list" && node.elems.length >= 2) {
    const h0 = node.elems[0]!;
    if (h0.tag === "sym" && nameEquals(h0.name, "pub")) {
      reexport = true;
      node = {
        tag: "list",
        kind: node.kind,
        elems: node.elems.slice(1),
        span: node.span,
      };
    }
  }
  if (node.tag !== "list" || node.elems.length < 2) return null;
  const h = node.elems[0]!;
  if (h.tag !== "sym" || !nameEquals(h.name, "import")) return null;
  form = node;
  const spec = form.elems[1]!;
  const aliasNode = form.elems[2];
  const alias =
    aliasNode?.tag === "sym" ? decodeBytes(aliasNode.name) : undefined;
  if (spec.tag === "str") return { spec: decodeBytes(spec.bytes), span: form.span, reexport, alias };
  if (spec.tag === "sym") return { spec: decodeBytes(spec.name), span: form.span, reexport, alias };
  return { spec: "", span: form.span, reexport, alias };
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

function isRuntime(form: Ast): boolean {
  if (form.tag !== "list" || form.elems.length === 0) return false;
  const h = form.elems[0]!;
  return h.tag === "sym" && nameEquals(h.name, "runtime");
}

export function declarationNames(form: Ast): string[] {
  if (form.tag !== "list" || form.elems.length < 2) return [];
  const h = form.elems[0]!;
  if (h.tag !== "sym") return [];
  const hn = new TextDecoder().decode(h.name);
  const letName = form.elems[1];
  if (hn === "let" && form.elems.length >= 3 && letName?.tag === "sym") {
    return [new TextDecoder().decode(letName.name)];
  }
  if (hn === "defn" || hn === "defrec" || hn === "alias" || hn === "extern" || hn === "runtime") {
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
