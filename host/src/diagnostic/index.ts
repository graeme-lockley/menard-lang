export type {
  Diagnostic,
  DiagnosticCategory,
  DiagnosticNote,
  DiagnosticSeverity,
} from "./diagnostic.ts";
export {
  diagnostic,
  parseErrorToDiagnostic,
  casingErrorToDiagnostic,
} from "./diagnostic.ts";

export type { LineMap, LineCol } from "./line-map.ts";
export { buildLineMap, offsetToLineCol, lineBytes } from "./line-map.ts";

export { formatDiagnostic, formatDiagnostics } from "./format.ts";
