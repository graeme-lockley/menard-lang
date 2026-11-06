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

export { operatorSpacingHelp } from "./operator-spacing.ts";

export { formatDiagnostic, formatDiagnostics } from "./format.ts";

export type {
  JsonSpan,
  JsonDiagnostic,
  DiagnosticsDocument,
  JsonPanicFrame,
  PanicDocument,
  PanicFrameLike,
} from "./json.ts";
export {
  DIAGNOSTICS_VERSION,
  spanToJson,
  diagnosticToJson,
  diagnosticsToJson,
  formatDiagnosticsJson,
  panicToJson,
  formatPanicJson,
} from "./json.ts";
