/**
 * Phase 2 slice 2A — TypeScript prototype for the Menard bitcode writer.
 *
 * This is a *reference only* tool: it is not imported by the host, the
 * compiler, or any test, and the compiler must not depend on it at
 * runtime. Its only job was to work out — and now to document — the exact
 * bit-level encoding that `src/emit/bc-writer.mnd` ports into Menard. Keep
 * it in sync with that module's algorithm if the encoding ever changes,
 * but treat this file as disposable: deleting it costs nothing the
 * Menard module doesn't already have.
 *
 * Run it directly:
 *
 *   bun run tools/bc-writer/write-ret0.ts /tmp/ret0.bc
 *   clang /tmp/ret0.bc -o /tmp/ret0 && /tmp/ret0; echo $?   # 0
 *
 * What it emits: raw (unwrapped) LLVM bitcode — magic `BC\xC0\xDE`, no
 * Darwin wrapper header (ADR 40: the compiler never shells out to
 * `llvm-as`; this tool doesn't either, it *is* the encoder) — for the
 * smallest module clang will link and run:
 *
 *   define i32 @main() {
 *     ret i32 0
 *   }
 *
 * ## The bitstream, in brief (https://llvm.org/docs/BitCodeFormat.html)
 *
 * A bitcode file is the 4-byte magic followed by a *bitstream*: a
 * sequence of bits, packed **LSB-first** into bytes (the first bit
 * written becomes bit 0 of the first byte). On top of that bit-packing
 * sit two primitive encodings:
 *
 *   - **Fixed(width)** — the low `width` bits of an unsigned integer.
 *   - **VBR(width)** — the value split into `(width-1)`-bit chunks, each
 *     chunk's high bit set iff another chunk follows (least-significant
 *     chunk first).
 *
 * And two structural ideas:
 *
 *   - **Blocks** — `ENTER_SUBBLOCK blockid abbrevwidth <align32> numwords
 *     <body> END_BLOCK <align32>`. `numwords` is the body's length in
 *     32-bit words, letting a reader skip a block it doesn't understand.
 *   - **Records** — this writer never defines abbreviations (no
 *     `DEFINE_ABBREV`, no `BLOCKINFO_BLOCK`), so every record is the
 *     generic `UNABBREV_RECORD code numops op...` form, with `code` and
 *     every operand VBR6. Abbreviations are a size optimization LLVM's
 *     reader has to support anyway for backward compatibility, so a
 *     writer skipping them entirely is fully within spec, just bigger.
 *   - Every abbreviation-id slot (`ENTER_SUBBLOCK`, `END_BLOCK`,
 *     `UNABBREV_RECORD`, ...) is `Fixed(2)` throughout this file: no
 *     block here has more than 4 abbrev ids, since none defines
 *     abbreviations, and 2 bits already covers ids 0-3, which is
 *     exactly {END_BLOCK, ENTER_SUBBLOCK, DEFINE_ABBREV, UNABBREV_RECORD}.
 *
 * ## Why the writer never backpatches
 *
 * `ENTER_SUBBLOCK`'s `numwords` field is written *before* the block's
 * body, but is only known *after* encoding it — the textbook fix is to
 * reserve the word and overwrite it once the body's length is known.
 * This writer never does that. Instead, each block's body is rendered
 * into its *own* byte buffer first (`renderBlockBody`), and only spliced
 * into the parent — as whole, already-aligned bytes — once its length is
 * known. This works because every block body's own trailing `END_BLOCK`
 * is immediately followed by an `align32`, so the rendered buffer is
 * *always* a whole number of bytes (in fact a whole number of 32-bit
 * words) — there is never a partial byte to carry across the splice.
 *
 * The reason this matters beyond elegance: Menard's only mutable
 * reference types are `Ref` and `StringBuffer` (ADR 5), and
 * `StringBuffer` is **append-only** — there is no "overwrite byte N"
 * operation (ADR 33/34). A backpatching writer cannot be ported to
 * Menard's `StringBuffer` at all; this append-only, render-then-splice
 * design can, and `src/emit/bc-writer.mnd` does exactly this.
 *
 * ## Why this uses no abbreviations, no BLOCKINFO, no string table
 *
 * A real clang/`llvm-as` module carries an `IDENTIFICATION_BLOCK`, a
 * `BLOCKINFO_BLOCK` full of `DEFINE_ABBREV`s used across blocks, and (for
 * module format version 2) a `STRTAB_BLOCK` holding every name, with
 * global values referencing it by `(offset, size)`. All of that is a size
 * optimization for large, real-world modules — none of it is required
 * for correctness, and LLVM's bitcode reader is built to accept the
 * plain, unabbreviated encoding of every record it knows (that's the
 * backward-compatibility contract that makes old bitcode still readable).
 * So this writer targets **module format version 0** (the pre-string-
 * table encoding): global value names live directly in the module's
 * `VALUE_SYMTAB` block as inline character operands
 * (`VST_CODE_ENTRY [valueid, char...]`), and the `MODULE_CODE_FUNCTION`
 * record has no `strtab_offset`/`strtab_size` fields at all — it starts
 * directly with the function's type. This is what let `llvm-bcanalyzer`
 * and clang validate a hand-written module without reverse-engineering
 * every field of the much larger, abbreviation-heavy modern encoding.
 *
 * ## The module structure this writes
 *
 *   MODULE_BLOCK (id 8)
 *     VERSION = 0
 *     TYPE_BLOCK_ID_NEW (id 17): void (idx 0), i32 (idx 1),
 *       `() -> i32` function type (idx 2)
 *     MODULE_CODE_FUNCTION: @main, type idx 2, ccc, has a body, external
 *     FUNCTION_BLOCK (id 12): body of @main
 *       DECLAREBLOCKS 1               ; one basic block
 *       CONSTANTS_BLOCK (id 11): SETTYPE i32, NULL   ; the constant `0`
 *       INST_RET <relative ref to the constant>
 *     VALUE_SYMTAB (id 14): ENTRY [valueid 0, "main"]  ; names @main
 *
 * `@main` is global value 0 (the only global value); the constant `0` is
 * the first per-function value, so it gets id 1 (right after the global
 * value count). `INST_RET`'s operand is LLVM's usual *relative* value
 * reference: `nextValueNumber − targetValueId` = `2 − 1` = `1` (the next
 * value number is 2 because the `ret` instruction itself would be value
 * 2 if it produced one, though it doesn't).
 *
 * Verified against `llvm-bcanalyzer --dump` (structure) and
 * `clang <file> -o <bin> && <bin>; echo $?` (semantics: exits 0) during
 * development — see the module comment in `src/emit/bc-writer.mnd` for
 * the ported version and its own test coverage.
 */

// ---------------------------------------------------------------------------
// BitSink: an append-only bit-level byte sink. `cur`/`nbits` hold pending
// bits not yet flushed to a whole byte; `bytes` holds flushed, byte-aligned
// output. This mirrors exactly what the Menard port builds from a `Ref
// Int` pair (pending value, pending bit count) plus a `StringBuffer`.

class BitSink {
  private bytes: number[] = [];
  private cur = 0; // pending bits not yet flushed, low bits valid
  private nbits = 0; // number of valid bits in `cur` (0-7 between calls)

  /** Write the low `width` bits of `value` (width <= 24, so cur never
   * needs more than 7 + 24 = 31 bits — comfortably inside a safe int,
   * and inside Menard's 63-bit tagged `Int`). */
  writeFixed(value: number, width: number): void {
    if (width === 0) return;
    if (value < 0 || value >= 2 ** width) {
      throw new Error(`writeFixed: ${value} does not fit in ${width} bits`);
    }
    // Bits of `value` occupy positions [nbits, nbits+width); bits already
    // in `cur` occupy [0, nbits). Disjoint ranges, so + is bitwise OR here.
    this.cur = this.cur + value * 2 ** this.nbits;
    this.nbits += width;
    while (this.nbits >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur = Math.floor(this.cur / 256);
      this.nbits -= 8;
    }
  }

  /** VBR(width): value's bits split into (width-1)-bit chunks, low chunk
   * first, each chunk's high bit set iff another chunk follows. Only
   * used here for non-negative values. */
  writeVBR(value: number, width: number): void {
    const contBit = 1 << (width - 1);
    const chunkMod = contBit; // 2^(width-1)
    let v = value;
    for (;;) {
      const chunk = v % chunkMod;
      v = Math.floor(v / chunkMod);
      if (v !== 0) {
        this.writeFixed(chunk + contBit, width);
      } else {
        this.writeFixed(chunk, width);
        break;
      }
    }
  }

  /** Pad with zero bits up to the next 32-bit boundary. Every block body
   * ends with one of these (right after its `END_BLOCK`), which is what
   * makes every rendered block body a whole number of bytes. */
  align32(): void {
    const totalBits = this.bytes.length * 8 + this.nbits;
    const rem = totalBits % 32;
    if (rem !== 0) this.writeFixed(0, 32 - rem);
  }

  /** Append already-aligned bytes verbatim. Only valid when this sink is
   * itself currently byte-aligned (`nbits === 0`) — true at the start,
   * and true after every `align32()`. */
  appendRawBytes(raw: ArrayLike<number>): void {
    if (this.nbits !== 0) throw new Error("appendRawBytes while not byte-aligned");
    for (let i = 0; i < raw.length; i++) this.bytes.push(raw[i] & 0xff);
  }

  byteLength(): number {
    if (this.nbits !== 0) throw new Error("byteLength while not byte-aligned");
    return this.bytes.length;
  }

  finish(): Uint8Array {
    if (this.nbits !== 0) throw new Error("finish while not byte-aligned (missing an align32?)");
    return new Uint8Array(this.bytes);
  }
}

// ---------------------------------------------------------------------------
// Bitstream structural helpers, built on BitSink. No DEFINE_ABBREV, no
// BLOCKINFO_BLOCK — every record is UNABBREV_RECORD, and every
// abbreviation-id slot is Fixed(2) (see the module comment above).

const END_BLOCK = 0;
const ENTER_SUBBLOCK = 1;
const UNABBREV_RECORD = 3;
const ABBREV_WIDTH = 2;

/** Render a block's body (records and nested blocks written via `cb`)
 * into its own byte buffer, terminated by END_BLOCK + align32. The
 * result is always a whole number of 32-bit words. */
function renderBlockBody(cb: (s: BitSink) => void): Uint8Array {
  const s = new BitSink();
  cb(s);
  s.writeFixed(END_BLOCK, ABBREV_WIDTH);
  s.align32();
  return s.finish();
}

/** Enter a subblock of `parent`: render its body in isolation, then
 * splice it in as raw bytes once the body's word count is known — see
 * the module comment's "why the writer never backpatches". */
function enterSubblock(parent: BitSink, blockId: number, cb: (s: BitSink) => void): void {
  const body = renderBlockBody(cb);
  parent.writeFixed(ENTER_SUBBLOCK, ABBREV_WIDTH);
  parent.writeVBR(blockId, 8);
  parent.writeVBR(ABBREV_WIDTH, 4);
  parent.align32();
  const numWords = body.length / 4;
  parent.appendRawBytes([numWords & 0xff, (numWords >>> 8) & 0xff, (numWords >>> 16) & 0xff, (numWords >>> 24) & 0xff]);
  parent.appendRawBytes(body);
}

function unabbrevRecord(s: BitSink, code: number, ops: number[]): void {
  s.writeFixed(UNABBREV_RECORD, ABBREV_WIDTH);
  s.writeVBR(code, 6);
  s.writeVBR(ops.length, 6);
  for (const op of ops) s.writeVBR(op, 6);
}

// ---------------------------------------------------------------------------
// Block IDs and record codes actually used (see llvm/Bitcode/LLVMBitCodes.h
// upstream; only the subset this module needs is named here).

const MODULE_BLOCK_ID = 8;
const CONSTANTS_BLOCK_ID = 11;
const FUNCTION_BLOCK_ID = 12;
const VALUE_SYMTAB_BLOCK_ID = 14;
const TYPE_BLOCK_ID_NEW = 17;

const MODULE_CODE_VERSION = 1;
const MODULE_CODE_FUNCTION = 8;

const TYPE_CODE_NUMENTRY = 1;
const TYPE_CODE_VOID = 2;
const TYPE_CODE_INTEGER = 7;
const TYPE_CODE_FUNCTION = 21;

const CST_CODE_SETTYPE = 1;
const CST_CODE_NULL = 2;

const FUNC_CODE_DECLAREBLOCKS = 1;
const FUNC_CODE_INST_RET = 10;

const VST_CODE_ENTRY = 1;

/** Build the raw (unwrapped) bitcode bytes for `define i32 @main() { ret
 * i32 0 }`. */
export function writeRet0MainBc(): Uint8Array {
  const top = new BitSink();
  top.appendRawBytes([0x42, 0x43, 0xc0, 0xde]); // 'B' 'C' 0xC0 0xDE

  enterSubblock(top, MODULE_BLOCK_ID, (m) => {
    unabbrevRecord(m, MODULE_CODE_VERSION, [0]);

    enterSubblock(m, TYPE_BLOCK_ID_NEW, (t) => {
      unabbrevRecord(t, TYPE_CODE_NUMENTRY, [3]);
      unabbrevRecord(t, TYPE_CODE_VOID, []); // type idx 0
      unabbrevRecord(t, TYPE_CODE_INTEGER, [32]); // type idx 1: i32
      unabbrevRecord(t, TYPE_CODE_FUNCTION, [0, 1]); // type idx 2: () -> i32
    });

    // @main: type idx 2, ccc, has a body (not just a declaration),
    // external linkage; the remaining fields (paramattrs, alignment,
    // section, visibility) are left at their all-zero defaults.
    unabbrevRecord(m, MODULE_CODE_FUNCTION, [2, 0, 0, 0, 0, 0, 0, 0]);

    enterSubblock(m, FUNCTION_BLOCK_ID, (f) => {
      unabbrevRecord(f, FUNC_CODE_DECLAREBLOCKS, [1]); // one basic block

      enterSubblock(f, CONSTANTS_BLOCK_ID, (c) => {
        unabbrevRecord(c, CST_CODE_SETTYPE, [1]); // subsequent constants: i32
        unabbrevRecord(c, CST_CODE_NULL, []); // value id 1: the i32 zero
      });

      // ret i32 <value id 1>, relative-encoded: nextValueNo(2) - id(1) = 1
      unabbrevRecord(f, FUNC_CODE_INST_RET, [1]);
    });

    enterSubblock(m, VALUE_SYMTAB_BLOCK_ID, (v) => {
      const nameBytes = Array.from(new TextEncoder().encode("main"));
      unabbrevRecord(v, VST_CODE_ENTRY, [0, ...nameBytes]); // value id 0 = @main
    });
  });

  return top.finish();
}

// ---------------------------------------------------------------------------
// CLI: write to the path given as argv[0], defaulting to ./ret0.bc.

if (import.meta.main) {
  const outPath = process.argv[2] ?? "ret0.bc";
  const bytes = writeRet0MainBc();
  await Bun.write(outPath, bytes);
  console.log(`wrote ${bytes.length} bytes to ${outPath}`);
}
