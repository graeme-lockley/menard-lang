/**
 * Float total order and NaN canonicalisation (LANG-03).
 * Mirrors `box_float` / `cmp_float` in the C runtime: one quiet NaN payload,
 * monotonic uint64 keys, bit equality for `=`.
 */

const CANON_NAN_BITS = 0x7ff8000000000000n;
const SIGN_BIT = 0x8000000000000000n;
const EXP_MASK = 0x7ff0000000000000n;
const FRAC_MASK = 0x000fffffffffffffn;

const bitBuf = new ArrayBuffer(8);
const bitF64 = new Float64Array(bitBuf);
const bitU64 = new BigUint64Array(bitBuf);

/** IEEE bits of a JS number (host endianness of the TypedArray view). */
export function floatBits(d: number): bigint {
  bitF64[0] = d;
  return bitU64[0]!;
}

export function floatFromBits(bits: bigint): number {
  bitU64[0] = bits;
  return bitF64[0]!;
}

/** Quiet NaN `0x7FF8000000000000`; other values unchanged. */
export function canonicalFloat(d: number): number {
  const bits = floatBits(d);
  if ((bits & EXP_MASK) === EXP_MASK && (bits & FRAC_MASK) !== 0n) {
    return floatFromBits(CANON_NAN_BITS);
  }
  return d;
}

/** Monotonic order key: `if (sign) ~bits else bits | sign`. */
export function floatOrderKey(d: number): bigint {
  const bits = floatBits(d);
  if ((bits & SIGN_BIT) !== 0n) {
    return bits ^ 0xffffffffffffffffn;
  }
  return bits | SIGN_BIT;
}

/** -1 / 0 / 1 under the LANG-03 total order. */
export function compareFloat(a: number, b: number): number {
  const ka = floatOrderKey(a);
  const kb = floatOrderKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
