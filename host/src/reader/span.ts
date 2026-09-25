/** Byte offsets into the source `Uint8Array` (half-open: [start, end)). */
export type Span = {
  start: number;
  end: number;
};

export function span(start: number, end: number): Span {
  return { start, end };
}
