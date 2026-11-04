/**
 * Shared byte-accurate rewrite applicator for `mn fix` rules (LANG-17 / TOOL-12).
 *
 * Spans are UTF-8 byte offsets into `source` (half-open `[start, end)`), matching
 * `host/src/reader/span.ts`. Do not slice JavaScript strings with these offsets.
 */

export type ByteRewrite = {
  start: number;
  end: number;
  replacement: Uint8Array;
};

/**
 * Apply edits to a UTF-8 source buffer. Untouched ranges are copied via
 * `subarray`. Edits may be unsorted; they are applied right-to-left so earlier
 * offsets stay valid. Overlapping spans are not supported.
 */
export function applyByteRewrites(source: Uint8Array, edits: ByteRewrite[]): Uint8Array {
  if (edits.length === 0) return source;

  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of ordered) {
    const before = out.subarray(0, e.start);
    const after = out.subarray(e.end);
    const next = new Uint8Array(before.length + e.replacement.length + after.length);
    next.set(before, 0);
    next.set(e.replacement, before.length);
    next.set(after, before.length + e.replacement.length);
    out = next;
  }
  return out;
}
