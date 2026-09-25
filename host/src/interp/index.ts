export type { Value, Env } from "./value.ts";
export {
  emptyEnv,
  envGet,
  envSet,
  vInt,
  vStr,
  vUnit,
  vBool,
  vVariant,
} from "./value.ts";
export { evalProgram, PanicError, type EvalResult } from "./eval.ts";
export { showValue, equalValue, compareValue, dumpValue } from "./derive.ts";
export {
  diagnose,
  run,
  formatRunErrors,
  type PipelineOpts,
  type RunResult,
  type RunOk,
  type RunErr,
  type RunPanic,
} from "./pipeline.ts";
