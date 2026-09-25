/**
 * Byte-oriented line map: maps a byte offset to 1-based line and 1-based column
 * (column counted in bytes, so invalid UTF-8 still reports stably).
 */
export type LineMap = {
  /** Byte offset of the start of each line (index 0 = line 1). */
  lineStarts: number[];
  sourceLength: number;
};

export function buildLineMap(source: Uint8Array): LineMap {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === 0x0a) {
      lineStarts.push(i + 1);
    }
  }
  return { lineStarts, sourceLength: source.length };
}

export type LineCol = { line: number; col: number };

export function offsetToLineCol(map: LineMap, offset: number): LineCol {
  const o = Math.max(0, Math.min(offset, map.sourceLength));
  // binary search last lineStart <= o
  let lo = 0;
  let hi = map.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map.lineStarts[mid]! <= o) lo = mid;
    else hi = mid - 1;
  }
  const lineStart = map.lineStarts[lo]!;
  return { line: lo + 1, col: o - lineStart + 1 };
}

/** Extract a single source line (without trailing \\n) by 1-based line number. */
export function lineBytes(source: Uint8Array, map: LineMap, line: number): Uint8Array {
  const idx = line - 1;
  if (idx < 0 || idx >= map.lineStarts.length) return new Uint8Array();
  const start = map.lineStarts[idx]!;
  let end =
    idx + 1 < map.lineStarts.length
      ? map.lineStarts[idx + 1]!
      : source.length;
  // drop trailing \\n
  if (end > start && source[end - 1] === 0x0a) end--;
  // drop trailing \\r
  if (end > start && source[end - 1] === 0x0d) end--;
  return source.subarray(start, end);
}
