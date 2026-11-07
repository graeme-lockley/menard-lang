/** Canonical `help:` strings for every actionable catalogue code (DOC-05).
 *  Specialized emits may override with a more specific hint; when they omit
 *  `help`, `diagnostic()` fills it from this map. Keep in sync with
 *  `src/diag/helps.mnd` and `docs/errors.md`.
 */
export const CATALOGUE_HELPS: Record<string, string> = {
  E_PARSE: "check the syntax near this character",
  E_PARSE_UNCLOSED: "close the opening delimiter",
  E_PARSE_BANG: "'!' may appear only as the final character of an identifier",
  E_PARSE_STRING: "close the string with a matching quote",
  E_CASING: "rename the constructor so it starts with an uppercase letter",

  E_DESUGAR_ARITY: "give the operator the arguments it expects",
  E_DESUGAR_COND_CLAUSE: "write each cond clause as a guard/body pair",
  E_DESUGAR_COND_ELSE: "move else to the last cond clause",
  E_DESUGAR_COND_EMPTY: "add at least one cond clause",
  E_DESUGAR_MAP: "write the map as { key => value, ... }",
  E_DESUGAR_MATCH: "write match with a scrutinee and | pattern -> body arms",
  E_DESUGAR_PIPE: "pipe requires a call on the right; write value |> f(args)",
  E_DESUGAR_WHEN: "write when as when (cond) body",
  E_DESUGAR_WHILE: "write while as while (cond) body",
  E_TYPE_REST: "put ... only on the last parameter, typed as (List T)",
  E_TYPE_SPREAD: "use ... only as the last argument of a rest-parameter call",

  E_TYPE_ARITY: "check the call: expected and found argument counts must match",
  E_TYPE_DEFN: "write defn as name(params) -> Ret = body",
  E_TYPE_DUPLICATE: "rename or remove the duplicate definition",
  E_TYPE_EXHAUSTIVE: "cover every constructor, or add a wildcard arm",
  E_TYPE_EXPR: "fix the type expression",
  E_TYPE_FN: "write the function type as Fn(Args) -> Ret",
  E_TYPE_LET: "write let as let name = expr",
  E_TYPE_LOOP: "write loop as loop (bindings) body",
  E_TYPE_MATCH: "write match with a scrutinee and pattern/body pairs",
  E_TYPE_MISMATCH: "change the expression to match the expected type",
  E_TYPE_NULLARY_CALL: "remove the parentheses; None is a value",
  E_TYPE_OCCURS: "break the cycle that makes this type infinite",
  E_TYPE_ORDERABLE: "only Int, Float, Str, Char, Bool, and variants of those are orderable",
  E_TYPE_RECUR: "use recur only inside a loop",
  E_TYPE_SHOWABLE: "use a showable type, or print via a custom function",
  E_TYPE_UNBOUND: "bind the name, or check the spelling",
  E_TYPE_UNKNOWN: "use a known type name, or define the type first",
  E_PUB_PRIVATE_TYPE: "make the type pub, or stop mentioning it in a pub signature",

  E_IMPORT: "fix the import form",
  E_IMPORT_CYCLE: "break the import cycle",
  E_IMPORT_MISSING: "create the module or fix the import path",
  E_IMPORT_VERSION: "use one version of the package across imports",
  E_EXTERN_FFI_PREFIX: "use the mn_ prefix only in seam modules",
  E_EXTERN_SEAM: "move the extern into a seam or /ffi/ module",
  E_RUNTIME_MODULE: "move the runtime form into an allowed stdlib module",
  E_TEST: "fix the failing assertion",
};

/** Variant helps documented under one code; also grepped by the sync test. */
export const CATALOGUE_HELP_VARIANTS: Record<string, string[]> = {
  E_PARSE: ["did you mean a == b?"],
  E_TYPE_UNBOUND: [
    "check the spelling, or qualify the constructor with its import alias",
    "operators need a space on both sides; did you mean `n + 1`?",
  ],
};

export function catalogueHelp(code: string): string | undefined {
  return CATALOGUE_HELPS[code];
}
