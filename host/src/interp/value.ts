import type {
  MenardMap,
  StringBuffer,
} from "../builtins/collections.ts";

export type Value =
  | { tag: "int"; value: bigint }
  | { tag: "float"; value: number }
  | { tag: "bool"; value: boolean }
  | { tag: "str"; bytes: Uint8Array }
  | { tag: "sym"; name: Uint8Array }
  | { tag: "char"; value: number }
  | { tag: "unit" }
  | { tag: "list"; elems: Value[] } // runtime list as array; Cons/Nil also as variants
  | { tag: "variant"; ctor: string; payloads: Value[] }
  | { tag: "record"; name: string; fields: Value[] }
  | { tag: "ref"; cell: { value: Value } }
  | { tag: "fn"; params: string[]; body: unknown; env: Env }
  | { tag: "builtin"; name: string }
  | { tag: "map"; map: MenardMap }
  | { tag: "sb"; sb: StringBuffer };

export type Env = {
  parent: Env | null;
  bindings: Map<string, Value>;
};

export function emptyEnv(parent: Env | null = null): Env {
  return { parent, bindings: new Map() };
}

export function envGet(env: Env, name: string): Value | undefined {
  let e: Env | null = env;
  while (e) {
    if (e.bindings.has(name)) return e.bindings.get(name);
    e = e.parent;
  }
  return undefined;
}

export function envSet(env: Env, name: string, v: Value): void {
  env.bindings.set(name, v);
}

export function vInt(n: bigint): Value {
  return { tag: "int", value: BigInt.asIntN(63, n) };
}

export function vStr(bytes: Uint8Array): Value {
  return { tag: "str", bytes };
}

export function vUnit(): Value {
  return { tag: "unit" };
}

export function vBool(b: boolean): Value {
  return { tag: "bool", value: b };
}

export function vVariant(ctor: string, payloads: Value[] = []): Value {
  return { tag: "variant", ctor, payloads };
}
