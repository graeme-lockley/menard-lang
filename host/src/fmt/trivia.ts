/**
 * Scan Menard source for full-line trivia: shebang, `;…` comments, blank runs.
 * Rejects CR (`\r`). Twin of src/fmt/trivia.mnd.
 */

export type TriviaKind = "shebang" | "comment" | "blank";

export type TriviaItem = {
  kind: TriviaKind;
  /** Byte offset of the first byte of this item. */
  start: number;
  /** Exclusive end offset (includes the trailing `\n` when present). */
  end: number;
  /**
   * Shebang/comment: text from `#!` / `;` through the last non-newline byte.
   * Blank: empty string; use `blankLines` for the run length.
   */
  text: string;
  /** For `blank` only: number of consecutive blank lines in the run. */
  blankLines?: number;
};

export type TriviaOk = { ok: true; items: TriviaItem[] };
export type TriviaErr = { ok: false; message: string; help?: string };
export type TriviaResult = TriviaOk | TriviaErr;

/** Decode a byte slice as latin1 so every source byte round-trips through `text`. */
function bytesToText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

function isSpace(b: number): boolean {
  return b === 0x20 || b === 0x09;
}

/**
 * Scan `src` for shebang, full-line comments, and blank-line runs.
 * Code lines (and any end-of-line `;` on them) are skipped — only full-line
 * comments are supported trivia.
 */
export function scanTrivia(src: Uint8Array): TriviaResult {
  for (let i = 0; i < src.length; i++) {
    if (src[i] === 0x0d) {
      return {
        ok: false,
        message: "CRLF line endings are not supported",
        help: "convert the file to LF (Unix) line endings",
      };
    }
  }

  const items: TriviaItem[] = [];
  let i = 0;

  // Shebang only as the very first two bytes.
  if (src.length >= 2 && src[0] === 0x23 && src[1] === 0x21) {
    const start = 0;
    i = 2;
    while (i < src.length && src[i] !== 0x0a) i++;
    const textEnd = i;
    if (i < src.length && src[i] === 0x0a) i++;
    items.push({
      kind: "shebang",
      start,
      end: i,
      text: bytesToText(src.subarray(start, textEnd)),
    });
  }

  while (i < src.length) {
    const lineStart = i;
    // Leading whitespace on the line.
    while (i < src.length && isSpace(src[i]!)) i++;

    if (i >= src.length) {
      // Trailing spaces with no newline — not a blank line.
      break;
    }

    const b = src[i]!;

    // Blank line: only whitespace then newline (or whitespace-only at EOF).
    if (b === 0x0a) {
      let blankStart = lineStart;
      let lines = 0;
      // Rewind to consume this and following blank lines as one run.
      i = lineStart;
      while (i < src.length) {
        const bs = i;
        while (i < src.length && isSpace(src[i]!)) i++;
        if (i < src.length && src[i] === 0x0a) {
          i++;
          lines++;
          if (lines === 1) blankStart = bs;
          continue;
        }
        // Non-blank (or EOF without newline after only spaces).
        i = bs;
        break;
      }
      if (lines > 0) {
        items.push({
          kind: "blank",
          start: blankStart,
          end: i,
          text: "",
          blankLines: lines,
        });
      }
      continue;
    }

    // Full-line comment.
    if (b === 0x3b) {
      const commentStart = i;
      while (i < src.length && src[i] !== 0x0a) i++;
      const textEnd = i;
      if (i < src.length && src[i] === 0x0a) i++;
      items.push({
        kind: "comment",
        start: lineStart,
        end: i,
        text: bytesToText(src.subarray(commentStart, textEnd)),
      });
      continue;
    }

    // Code line — skip to end of line (EOL comments on code lines are dropped).
    while (i < src.length && src[i] !== 0x0a) i++;
    if (i < src.length && src[i] === 0x0a) i++;
  }

  return { ok: true, items };
}
