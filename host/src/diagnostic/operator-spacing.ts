/** Single-byte ops that can be glued into an identifier. */
const OPS = "+-*/%<>";

const SIMPLE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SIMPLE_INT = /^[0-9]+$/;

function isSimpleAtom(s: string): boolean {
  return SIMPLE_IDENT.test(s) || SIMPLE_INT.test(s);
}

function letterStart(s: string): boolean {
  const c = s.charCodeAt(0);
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x5f;
}

/**
 * When an unbound name looks like a binary operator missing spaces, return
 * a `help:` hint. Returns undefined for kebab names, module paths, float
 * family names, trailing ops, and names with `:` / `@`.
 */
export function operatorSpacingHelp(name: string): string | undefined {
  if (name.includes(":") || name.includes("@")) return undefined;

  let split = -1;
  let op = "";
  for (let i = 0; i < name.length; i++) {
    const c = name[i]!;
    if (!OPS.includes(c)) continue;
    if (split >= 0) return undefined;
    split = i;
    op = c;
  }
  if (split < 0) return undefined;

  const left = name.slice(0, split);
  const right = name.slice(split + 1);
  if (left.length === 0 || right.length === 0) return undefined;
  if (!isSimpleAtom(left) || !isSimpleAtom(right)) return undefined;

  // Kebab: `is-negative` — `-` followed by a letter-starting side.
  if (op === "-" && letterStart(right)) return undefined;
  // Module path: `std/list`.
  if (op === "/" && letterStart(left) && letterStart(right)) return undefined;
  // Float-family name: `f-1`.
  if (op === "-" && left === "f" && SIMPLE_INT.test(right)) return undefined;

  return `operators need a space on both sides; did you mean \`${left} ${op} ${right}\`?`;
}
