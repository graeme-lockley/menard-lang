/**
 * Resolve-before-eval helpers: decode symbols once per AST node and map
 * special-form heads to opcodes so the driver does not re-scan names.
 */

const symCache = new WeakMap<Uint8Array, string>();

export function decodeSymBytes(name: Uint8Array): string {
  let s = symCache.get(name);
  if (s === undefined) {
    s = new TextDecoder().decode(name);
    symCache.set(name, s);
  }
  return s;
}

/** Special-form opcodes; 0 = not a special form. */
export const enum Sf {
  None = 0,
  If = 1,
  Let = 2,
  Do = 3,
  Loop = 4,
  Recur = 5,
  Panic = 6,
  Return = 7,
  Match = 8,
  Fn = 9,
  Quote = 10,
  Set = 11,
  Decl = 12, // defn/defrec/variant/alias — no-op as expression
}

const SF_BY_NAME: Record<string, Sf> = {
  if: Sf.If,
  let: Sf.Let,
  do: Sf.Do,
  loop: Sf.Loop,
  recur: Sf.Recur,
  panic: Sf.Panic,
  return: Sf.Return,
  match: Sf.Match,
  fn: Sf.Fn,
  lambda: Sf.Fn,
  quote: Sf.Quote,
  "set!": Sf.Set,
  defn: Sf.Decl,
  defrec: Sf.Decl,
  variant: Sf.Decl,
  alias: Sf.Decl,
};

const sfCache = new WeakMap<Uint8Array, Sf>();

export function specialFormOf(name: Uint8Array): Sf {
  let op = sfCache.get(name);
  if (op === undefined) {
    const s = decodeSymBytes(name);
    op = SF_BY_NAME[s] ?? Sf.None;
    sfCache.set(name, op);
  }
  return op;
}
