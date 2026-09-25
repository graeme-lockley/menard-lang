export type {
  Type,
  Scheme,
  TypeDef,
  RecordField,
  VariantCtor,
} from "./types.ts";
export {
  prim,
  tFn,
  tList,
  tMap,
  tMaybe,
  tResult,
  tRef,
  typeEqual,
  typeShow,
} from "./types.ts";

export { emptyEnv, typecheckForms, parseTypeExpr, type TypeEnv } from "./check.ts";
