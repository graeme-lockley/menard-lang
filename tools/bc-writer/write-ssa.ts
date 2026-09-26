/**
 * Phase 2 slice — TypeScript prototype for a *multi-function, real-instruction*
 * Menard bitcode writer (module format **version 1**: relative value-operand
 * encoding, basic-block targets absolute, per-function constants interleaved
 * lazily in the instruction stream). This is the sequel to `write-ret0.ts`
 * (slice 2A's single-constant `ret i32 N` writer, module version 0): where
 * that file could only ever emit one function with one instruction, this one
 * emits arbitrarily many functions, each with real `alloca`/`store`/`load`/
 * `binop`/`icmp`/`br`/`call`/`cast`/`ret` instructions over the tagged-`Int`
 * ABI (`t(v) = (v << 1) | 1`, spec §2.2/§3.4).
 *
 * *Reference only* — see `write-ret0.ts`'s header comment for the same
 * disclaimer: nothing in the compiler or its tests imports this file at
 * runtime. Its job is to work out (and document) the exact bit-level
 * encoding `src/emit/bc-writer.mnd`'s `write-module-bc` ports into Menard,
 * validated against `llvm-bcanalyzer --dump` and `clang` on this machine's
 * pinned LLVM (23.1.2) before porting a single byte of it.
 *
 * Run it directly:
 *
 *   bun run tools/bc-writer/write-ssa.ts /tmp/demo.bc
 *   clang /tmp/demo.bc -o /tmp/demo && /tmp/demo; echo $?
 *
 * ## How the encoding was worked out
 *
 * Hand-writing a multi-function, multi-block `.ll` exercising every
 * instruction this writer needs (`alloca`/`add`/`sub`/`store`/`load`/
 * `icmp`/`br` conditional+unconditional/`call`/`lshr`/`trunc`/`ret`),
 * assembling it with the *real* `llvm-as` (never done by the compiler
 * itself — ADR 40 — only by this development-time investigation), and
 * reading every record's operands back out of `llvm-bcanalyzer --dump`
 * against a hand-computed absolute value-id timeline (globals, then each
 * function's own params/constants/instructions, numbered in bitstream
 * order) is what pinned down every field below. The key findings that
 * are *not* obvious from the format's own docs:
 *
 * - **Relative value ids** (module version >= 1) apply per-*operand-field*,
 *   not per-record: most instruction operands (binop/cmp2 lhs+rhs,
 *   store ptr+val, load ptr, call callee+args, cast/ret operand, br's
 *   *condition*) are `nextValueNo - targetAbsoluteId`, where `nextValueNo`
 *   is the count of values defined so far (globals, then this function's
 *   own params/constants/instructions, in exactly the order they appear
 *   in the bitstream) *before* the instruction being written (its own
 *   result, if it has one, is not yet counted). But **`alloca`'s
 *   array-size operand is the plain absolute id**, not relative —
 *   confirmed directly from the dump (the same constant, referenced from
 *   two `alloca`s at different points in a function, encodes to the same
 *   raw operand value both times, which relative encoding would not
 *   produce).
 * - **Basic-block targets are absolute small integers**, never relative —
 *   `br`'s (and conditional `br`'s two labels') operand(s) are simply the
 *   0-based index of the target block in declaration order, unaffected by
 *   `nextValueNo` entirely.
 * - **A function's `CONSTANTS_BLOCK` need not be one block up front.**
 *   Nothing in the format requires every per-function constant to be
 *   declared in a single subblock right after `DECLAREBLOCKS`; a fresh,
 *   tiny `CONSTANTS_BLOCK` may appear anywhere in the instruction stream,
 *   and the constant(s) inside it are numbered exactly where that
 *   subblock sits in the stream (immediately after whatever value came
 *   right before it). This writer (and its Menard port) exploits that:
 *   a constant is materialized **lazily, inline**, the first time an
 *   instruction needs it — no separate "collect every constant a function
 *   will need" pre-pass, one linear walk of the body suffices.
 * - **`INST_ALLOCA`'s align field carries the "explicit type" bit** (bit
 *   6, value 64) permanently set: with opaque pointers (`ptr`, no pointee
 *   type), the reader cannot recover the allocated type from the pointer's
 *   own type the way it could with a typed `T*`, so the record must carry
 *   it explicitly, flagged by this bit. The low bits are `log2(align) + 1`
 *   (so `align 8` -> `3 + 1 = 4`; combined: `4 | 64 = 68`).
 * - **`INST_STORE`/`INST_LOAD` do *not* carry that bit** — only `alloca`
 *   does. `STORE`'s fields are `[ptrRel, valRel, alignCode, isVolatile]`
 *   (no explicit type: the stored value already carries its own type in
 *   the value table). `LOAD`'s fields are `[ptrRel, destTypeIdx,
 *   alignCode, isVolatile]` (needs the explicit type: this is exactly the
 *   *opposite* direction from `store`, and *does* need it, since nothing
 *   else tells the reader what type is being loaded through an opaque
 *   `ptr`).
 * - **`INST_CALL`'s calling-convention field is `cc | (1 << 15)`** — bit
 *   15 is the "explicit callee type follows" flag, always set here (again
 *   an opaque-pointer consequence: the callee's function type can't be
 *   read off the pointee type of an opaque `ptr @callee`), `cc = 0` (C
 *   calling convention, spec §3.4's "C calling convention everywhere").
 *   Fields: `[paramAttrs(0), ccInfo, calleeFnTypeIdx, calleeRel, argRel…]`.
 * - **`ICMP` predicate codes**: confirmed `SLT = 40` from the dump,
 *   matching upstream `CmpInst::Predicate`'s `ICMP_SLT` (`FIRST_ICMP_PREDICATE
 *   (EQ=32) + 8`); the rest of the small set this writer needs follow the
 *   same enum (`EQ=32, NE=33, SGT=38, SGE=39, SLT=40, SLE=41`).
 * - **`TYPE_CODE_OPAQUE_POINTER = 25`**, one field (address space; `0`
 *   here) — confirmed from the dump (`llvm-bcanalyzer` on this build
 *   doesn't know the code's name — "UnknownCode25" — but decodes the one
 *   operand correctly, and clang accepts it as `ptr`).
 * - **No `VALUE_SYMTAB` inside a `FUNCTION_BLOCK` is required.** Real
 *   `clang`-emitted modules include one (so `llvm-dis` can print `%r`
 *   instead of `%3`), but it is purely cosmetic — an anonymous SSA value
 *   is completely valid IR. This writer omits it (as slice 2A's did too),
 *   keeping every function body to instructions (and inline constants)
 *   only.
 * - **Module version 1, not 2**: version 2 additionally requires a
 *   `STRTAB_BLOCK` and offset/size pairs instead of inline names in
 *   `VALUE_SYMTAB`/`MODULE_CODE_FUNCTION`. Version 1 keeps version 0's
 *   inline-name `VST_CODE_ENTRY` shape (see `write-ret0.ts`) while still
 *   switching instruction operands to relative ids — exactly the one
 *   feature this writer needs and version 0 doesn't have.
 *
 * See `src/emit/bc-writer.mnd`'s header comment for the ported version.
 */

// ---------------------------------------------------------------------------
// BitSink — identical algorithm to write-ret0.ts's (see that file's header
// comment for the append-only/no-backpatch rationale); repeated here rather
// than imported so this file stays a single, standalone reference artifact.

class BitSink {
  private bytes: number[] = [];
  private cur = 0;
  private nbits = 0;

  writeFixed(value: number, width: number): void {
    if (width === 0) return;
    if (value < 0 || value >= 2 ** width) {
      throw new Error(`writeFixed: ${value} does not fit in ${width} bits`);
    }
    this.cur = this.cur + value * 2 ** this.nbits;
    this.nbits += width;
    while (this.nbits >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur = Math.floor(this.cur / 256);
      this.nbits -= 8;
    }
  }

  writeVBR(value: number, width: number): void {
    const contBit = 1 << (width - 1);
    const chunkMod = contBit;
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

  align32(): void {
    const totalBits = this.bytes.length * 8 + this.nbits;
    const rem = totalBits % 32;
    if (rem !== 0) this.writeFixed(0, 32 - rem);
  }

  appendRawBytes(raw: ArrayLike<number>): void {
    if (this.nbits !== 0) throw new Error("appendRawBytes while not byte-aligned");
    for (let i = 0; i < raw.length; i++) this.bytes.push(raw[i] & 0xff);
  }

  finish(): Uint8Array {
    if (this.nbits !== 0) throw new Error("finish while not byte-aligned (missing an align32?)");
    return new Uint8Array(this.bytes);
  }
}

const END_BLOCK = 0;
const ENTER_SUBBLOCK = 1;
const UNABBREV_RECORD = 3;
const ABBREV_WIDTH = 2;

function renderBlockBody(cb: (s: BitSink) => void): Uint8Array {
  const s = new BitSink();
  cb(s);
  s.writeFixed(END_BLOCK, ABBREV_WIDTH);
  s.align32();
  return s.finish();
}

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
// Block ids / record codes (see llvm/Bitcode/LLVMBitCodes.h; confirmed
// against the dump per this file's header comment).

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
const TYPE_CODE_OPAQUE_POINTER = 25;

const CST_CODE_SETTYPE = 1;
const CST_CODE_NULL = 2;
const CST_CODE_INTEGER = 4;

const FUNC_CODE_DECLAREBLOCKS = 1;
const FUNC_CODE_INST_BINOP = 2;
const FUNC_CODE_INST_CAST = 3;
const FUNC_CODE_INST_RET = 10;
const FUNC_CODE_INST_BR = 11;
const FUNC_CODE_INST_LOAD = 20;
const FUNC_CODE_INST_CALL = 34;
const FUNC_CODE_INST_CMP2 = 28;
const FUNC_CODE_INST_ALLOCA = 19;
const FUNC_CODE_INST_STORE = 44;

const VST_CODE_ENTRY = 1;

// Binop opcodes (llvm::Instruction -> bitcode encoding; the subset this
// writer needs).
export const BINOP_ADD = 0;
export const BINOP_SUB = 1;
export const BINOP_MUL = 2;
export const BINOP_SDIV = 4;
export const BINOP_SREM = 6;
export const BINOP_SHL = 7;
export const BINOP_LSHR = 8;
export const BINOP_ASHR = 9;
export const BINOP_OR = 11;

// Cast opcodes.
export const CAST_TRUNC = 0;

// ICmp predicates (CmpInst::Predicate; ICMP_* start at 32).
export const ICMP_EQ = 32;
export const ICMP_NE = 33;
export const ICMP_SGT = 38;
export const ICMP_SGE = 39;
export const ICMP_SLT = 40;
export const ICMP_SLE = 41;

// Fixed leading type-table indices every module here uses (see
// `writeTypes`): every module gets exactly these four, then one function
// type per distinct arity 0..maxArity for `(i64 x arity) -> i64`, then one
// trailing `() -> i32` for `main`.
export const TY_PTR = 0;
export const TY_I64 = 1;
export const TY_I32 = 2;
export const TY_VOID = 3;

function funcTypeIdxForArity(arity: number): number {
  return 4 + arity;
}
function mainTypeIdx(maxArity: number): number {
  return 4 + (maxArity + 1);
}

function encodeSignedInt64(v: bigint): number {
  return Number(v >= 0n ? v * 2n : -v * 2n + 1n);
}

// ---------------------------------------------------------------------------
// The module-level IR this writer accepts: a flat list of functions, each
// a flat "item" list (instructions *and* the occasional inline constant
// declaration — see header comment's "lazily, inline"). Basic-block
// boundaries are implicit: a new block begins right after a terminator
// (`br`/`condbr`/`ret`), exactly as the bitcode format itself represents
// them — nothing here tags an instruction with "which block it's in".

type Item =
  | { k: "const"; ty: number; encoded: number }
  | { k: "alloca"; sizeConstAbs: number }
  | { k: "binop"; op: number; lhs: number; rhs: number }
  | { k: "cmp2"; pred: number; lhs: number; rhs: number }
  | { k: "cast"; op: number; val: number; toTy: number }
  | { k: "store"; ptr: number; val: number }
  | { k: "load"; ptr: number }
  | { k: "br"; bb: number }
  | { k: "condbr"; trueBB: number; falseBB: number; cond: number }
  | { k: "call"; callee: number; args: number[] }
  | { k: "ret"; val: number };

/**
 * Per-function SSA value-id bookkeeping — the direct Menard-portable
 * algorithm (see `src/emit/lower.mnd`'s `Builder`): `nextVal` is the
 * running absolute value-id counter (starts at `numGlobals`, since this
 * function's own params are numbered immediately after every module-scope
 * global value, before anything else); each value-producing item's own
 * result gets `nextVal` (then `nextVal += 1`); every operand reference is
 * resolved to `nextVal(at time of use) - targetAbsoluteId` (relative,
 * version 1) at the point the item referencing it is *appended* — never
 * patched later, so items must be appended in final stream order.
 */
export class FuncBuilder {
  readonly items: Item[] = [];
  private nextVal: number;
  private nextBB = 1; // block 0 (entry) is already "current"
  readonly paramIds: number[] = [];
  private readonly constCache = new Map<string, number>();

  constructor(numGlobals: number, nparams: number) {
    this.nextVal = numGlobals;
    for (let i = 0; i < nparams; i++) this.paramIds.push(this.nextVal++);
  }

  private rel(targetAbsId: number): number {
    return this.nextVal - targetAbsId;
  }

  /** A fresh basic-block index for a not-yet-emitted block (its first
   * item must be the very next one appended). */
  freshBB(): number {
    return this.nextBB++;
  }

  totalBlocks(): number {
    return this.nextBB;
  }

  /** An `i64` constant (raw value, not tagged — callers tag it themselves
   * via `constTaggedInt` below when they need `Int`'s representation, or
   * pass an already-tagged value here directly for e.g. a retag shift
   * amount). Deduped per function. */
  constI64(raw: bigint): number {
    const key = `i64:${raw}`;
    const cached = this.constCache.get(key);
    if (cached !== undefined) return cached;
    const encoded = encodeSignedInt64(raw);
    this.items.push({ k: "const", ty: TY_I64, encoded });
    const id = this.nextVal++;
    this.constCache.set(key, id);
    return id;
  }

  /** An `i32` constant — only ever `1` here (`alloca`'s fixed array
   * size), but kept general. */
  constI32(raw: bigint): number {
    const key = `i32:${raw}`;
    const cached = this.constCache.get(key);
    if (cached !== undefined) return cached;
    const encoded = encodeSignedInt64(raw); // same zig-zag scheme, any width
    this.items.push({ k: "const", ty: TY_I32, encoded });
    const id = this.nextVal++;
    this.constCache.set(key, id);
    return id;
  }

  /** `Int`'s own tagged encoding: `t(v) = (v << 1) | 1`. */
  constTaggedInt(v: bigint): number {
    return this.constI64(v * 2n + 1n);
  }

  /** `alloca i64, align 8` (every local slot in this ABI is one word). */
  alloca(): number {
    const size = this.constI32(1n);
    this.items.push({ k: "alloca", sizeConstAbs: size });
    return this.nextVal++;
  }

  binop(op: number, lhsAbs: number, rhsAbs: number): number {
    this.items.push({ k: "binop", op, lhs: this.rel(lhsAbs), rhs: this.rel(rhsAbs) });
    return this.nextVal++;
  }

  cmp2(pred: number, lhsAbs: number, rhsAbs: number): number {
    this.items.push({ k: "cmp2", pred, lhs: this.rel(lhsAbs), rhs: this.rel(rhsAbs) });
    return this.nextVal++;
  }

  cast(op: number, valAbs: number, toTy: number): number {
    this.items.push({ k: "cast", op, val: this.rel(valAbs), toTy });
    return this.nextVal++;
  }

  store(ptrAbs: number, valAbs: number): void {
    this.items.push({ k: "store", ptr: this.rel(ptrAbs), val: this.rel(valAbs) });
  }

  load(ptrAbs: number): number {
    this.items.push({ k: "load", ptr: this.rel(ptrAbs) });
    return this.nextVal++;
  }

  br(bb: number): void {
    this.items.push({ k: "br", bb });
  }

  condbr(trueBB: number, falseBB: number, condAbs: number): void {
    this.items.push({ k: "condbr", trueBB, falseBB, cond: this.rel(condAbs) });
  }

  /** `calleeAbsId` is the callee's module-scope global value id (functions
   * are numbered `0..N-1` in module order, before any function body —
   * see `emitModule`); relative refs work identically for globals and
   * locals (confirmed by the dump). */
  call(calleeAbsId: number, argAbsIds: number[]): number {
    this.items.push({ k: "call", callee: this.rel(calleeAbsId), args: argAbsIds.map((a) => this.rel(a)) });
    return this.nextVal++;
  }

  ret(valAbs: number): void {
    this.items.push({ k: "ret", val: this.rel(valAbs) });
  }
}

export interface FuncSpec {
  name: string;
  nparams: number;
  isMain: boolean;
  build: (b: FuncBuilder, funcIndex: (name: string) => number) => void;
}

function writeTypes(t: BitSink, maxArity: number): void {
  const numFuncTypes = maxArity + 1;
  unabbrevRecord(t, TYPE_CODE_NUMENTRY, [4 + numFuncTypes + 1]);
  unabbrevRecord(t, TYPE_CODE_OPAQUE_POINTER, [0]); // idx 0: ptr, addrspace 0
  unabbrevRecord(t, TYPE_CODE_INTEGER, [64]); // idx 1: i64
  unabbrevRecord(t, TYPE_CODE_INTEGER, [32]); // idx 2: i32
  unabbrevRecord(t, TYPE_CODE_VOID, []); // idx 3: void
  for (let arity = 0; arity <= maxArity; arity++) {
    const params = new Array(arity).fill(TY_I64);
    unabbrevRecord(t, TYPE_CODE_FUNCTION, [0, TY_I64, ...params]); // idx 4+arity
  }
  unabbrevRecord(t, TYPE_CODE_FUNCTION, [0, TY_I32]); // idx 4+numFuncTypes: () -> i32
}

/** One function's `FUNCTION_BLOCK` body: `DECLAREBLOCKS`, then every item
 * in stream order — an inline `CONSTANTS_BLOCK` for each `{k:"const"}`
 * item, an ordinary record for everything else. */
function emitFuncBody(fb: BitSink, b: FuncBuilder): void {
  unabbrevRecord(fb, FUNC_CODE_DECLAREBLOCKS, [b.totalBlocks()]);

  for (const item of b.items) {
    switch (item.k) {
      case "const":
        enterSubblock(fb, CONSTANTS_BLOCK_ID, (c) => {
          unabbrevRecord(c, CST_CODE_SETTYPE, [item.ty]);
          if (item.encoded === 0) unabbrevRecord(c, CST_CODE_NULL, []);
          else unabbrevRecord(c, CST_CODE_INTEGER, [item.encoded]);
        });
        break;
      case "alloca":
        // [allocatedTy(i64), sizeTy(i32), sizeValAbs, align|explicitType]
        unabbrevRecord(fb, FUNC_CODE_INST_ALLOCA, [TY_I64, TY_I32, item.sizeConstAbs, 68]);
        break;
      case "binop":
        unabbrevRecord(fb, FUNC_CODE_INST_BINOP, [item.lhs, item.rhs, item.op]);
        break;
      case "cmp2":
        unabbrevRecord(fb, FUNC_CODE_INST_CMP2, [item.lhs, item.rhs, item.pred]);
        break;
      case "cast":
        unabbrevRecord(fb, FUNC_CODE_INST_CAST, [item.val, item.toTy, item.op]);
        break;
      case "store":
        unabbrevRecord(fb, FUNC_CODE_INST_STORE, [item.ptr, item.val, 4, 0]); // align 8
        break;
      case "load":
        unabbrevRecord(fb, FUNC_CODE_INST_LOAD, [item.ptr, TY_I64, 4, 0]);
        break;
      case "br":
        unabbrevRecord(fb, FUNC_CODE_INST_BR, [item.bb]);
        break;
      case "condbr":
        unabbrevRecord(fb, FUNC_CODE_INST_BR, [item.trueBB, item.falseBB, item.cond]);
        break;
      case "call": {
        const CCINFO_C_EXPLICIT_TYPE = 1 << 15;
        unabbrevRecord(fb, FUNC_CODE_INST_CALL, [
          0,
          CCINFO_C_EXPLICIT_TYPE,
          funcTypeIdxForArity(item.args.length),
          item.callee,
          ...item.args,
        ]);
        break;
      }
      case "ret":
        unabbrevRecord(fb, FUNC_CODE_INST_RET, [item.val]);
        break;
    }
  }
}

/**
 * Build a raw (unwrapped) bitcode module for `funcs` (in the order given —
 * this fixes each function's module-scope global value id, `0..N-1`,
 * which `call` operands reference). Every function's params/return are
 * `i64` (tagged `Int`) except the one `isMain` function, whose `ret` is
 * `i32` — `build`'s own callback is responsible for ending a `main`
 * function's body with `lshr 1; trunc i32; ret i32` on its final tagged
 * value (this writer does not add that automatically; see `demoModule`).
 */
export function emitModule(funcs: FuncSpec[]): Uint8Array {
  const numGlobals = funcs.length;
  const maxArity = Math.max(0, ...funcs.map((f) => f.nparams));
  const nameToIdx = new Map(funcs.map((f, i) => [f.name, i] as const));
  const funcIndex = (name: string): number => {
    const idx = nameToIdx.get(name);
    if (idx === undefined) throw new Error(`emitModule: unknown function ${name}`);
    return idx;
  };

  const builders = funcs.map((f) => {
    const b = new FuncBuilder(numGlobals, f.nparams);
    f.build(b, funcIndex);
    return b;
  });

  const top = new BitSink();
  top.appendRawBytes([0x42, 0x43, 0xc0, 0xde]);

  enterSubblock(top, MODULE_BLOCK_ID, (m) => {
    unabbrevRecord(m, MODULE_CODE_VERSION, [1]); // version 1: relative value ids

    enterSubblock(m, TYPE_BLOCK_ID_NEW, (t) => writeTypes(t, maxArity));

    for (const f of funcs) {
      const tyIdx = f.isMain ? mainTypeIdx(maxArity) : funcTypeIdxForArity(f.nparams);
      // [type, callingconv, isproto(0=has body), linkage(0=external),
      //  paramattr, alignment, section, visibility]
      unabbrevRecord(m, MODULE_CODE_FUNCTION, [tyIdx, 0, 0, 0, 0, 0, 0, 0]);
    }

    for (let i = 0; i < funcs.length; i++) {
      enterSubblock(m, FUNCTION_BLOCK_ID, (fb) => emitFuncBody(fb, builders[i]));
    }

    enterSubblock(m, VALUE_SYMTAB_BLOCK_ID, (v) => {
      for (let i = 0; i < funcs.length; i++) {
        const bytes = Array.from(new TextEncoder().encode(funcs[i].name));
        unabbrevRecord(v, VST_CODE_ENTRY, [i, ...bytes]);
      }
    });
  });

  return top.finish();
}

// ---------------------------------------------------------------------------
// Demo module, exercising every instruction this writer supports:
//
//   answer(n: Int) -> Int { n + 2 }
//   main() -> Int {
//     let x = answer(40)             -- CALL, ALLOCA/STORE/LOAD (the `let`)
//     if x < tag(100) then x - tag(1) else x + tag(1)  -- CMP2, BR cond, ALLOCA/STORE/LOAD (the if-result slot)
//     -- untag -> i32, ret i32
//   }
//
// Expected: answer(40) = 42 (tagged 85); 42 < 100, so the if takes the
// `then` branch: 42 - 1 = 41. `main` exits 41.
function demoModule(): Uint8Array {
  const funcs: FuncSpec[] = [
    {
      name: "answer",
      nparams: 1,
      isMain: false,
      build: (b) => {
        const n = b.paramIds[0];
        const two = b.constTaggedInt(2n);
        const sum = b.binop(BINOP_ADD, n, two); // t(n)+t(2)
        const one = b.constI64(1n); // untagged 1, for the "-1" fixup
        const result = b.binop(BINOP_SUB, sum, one); // == t(n+2)
        b.ret(result);
      },
    },
    {
      name: "main",
      nparams: 0,
      isMain: true,
      build: (b, funcIndex) => {
        // let x = (answer 40)
        const arg40 = b.constTaggedInt(40n);
        const callResult = b.call(funcIndex("answer"), [arg40]);
        const xSlot = b.alloca();
        b.store(xSlot, callResult);
        const x = b.load(xSlot);

        // if (< x 100) ...
        const hundred = b.constTaggedInt(100n);
        const cond = b.cmp2(ICMP_SLT, x, hundred);
        const thenBB = b.freshBB();
        const elseBB = b.freshBB();
        const joinBB = b.freshBB();
        const resultSlot = b.alloca();
        // Both constants this branch needs must be defined here, in the
        // entry block (which dominates `then`/`else`/`join` alike) — not
        // lazily inside `then`, which would leave `else`'s later use of
        // them without a dominating definition. Two *different* "1"s:
        // `oneTag` is the tagged `Int` literal `1` (`t(1) = 3`), the
        // right-hand operand of `x - 1`/`x + 1` themselves; `oneRaw` is
        // the untagged machine integer `1`, the free add/sub identity's
        // own `+1`/`-1` fixup (spec §2.2: `t(a)+t(b)-1 == t(a+b)`).
        const oneTag = b.constTaggedInt(1n);
        const oneRaw = b.constI64(1n);
        b.condbr(thenBB, elseBB, cond);

        // then: x - 1, i.e. t(x) - t(1) + 1 (tagged sub) — block
        // boundaries are implicit (a new block starts right after the
        // previous terminator), so nothing marks the start of
        // `then`/`else`/`join` themselves; `freshBB` already reserved
        // their indices above, in the exact order their first item is
        // about to appear below.
        const xThen = b.load(xSlot);
        const subT = b.binop(BINOP_SUB, xThen, oneTag);
        const thenVal = b.binop(BINOP_ADD, subT, oneRaw);
        b.store(resultSlot, thenVal);
        b.br(joinBB);

        // else: x + 1, i.e. t(x) + t(1) - 1 (tagged add)
        const xElse = b.load(xSlot);
        const addE = b.binop(BINOP_ADD, xElse, oneTag);
        const elseVal = b.binop(BINOP_SUB, addE, oneRaw);
        b.store(resultSlot, elseVal);
        b.br(joinBB);

        // join: load result, untag -> i32, ret
        const rv = b.load(resultSlot);
        const untagged = b.binop(BINOP_LSHR, rv, oneRaw);
        const asI32 = b.cast(CAST_TRUNC, untagged, TY_I32);
        b.ret(asI32);
      },
    },
  ];
  return emitModule(funcs);
}

if (import.meta.main) {
  const outPath = process.argv[2] ?? "/tmp/ssa-demo.bc";
  const bytes = demoModule();
  await Bun.write(outPath, bytes);
  console.log(`wrote ${bytes.length} bytes to ${outPath}`);
}
