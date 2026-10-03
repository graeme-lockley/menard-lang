/*
 * Menard runtime — C11, phase 2/3.
 *
 * Every Menard value occupies one 64-bit word (spec §2.2): a tagged
 * immediate (odd) or a pointer to a heap or static object (even, 8-byte
 * aligned). `MnWord` is that word.
 *
 * Phase 4 collector: a copying nursery plus a mark-sweep old space.
 * `mn_alloc` may move heap objects. Static objects (shape location
 * `MN_LOC_STATIC`) never move. Roots live on the shadow stack
 * (`mn_root_push` / `mn_root_pop`); see spec §4.3 and §4.4.
 */
#ifndef MENARD_RUNTIME_H
#define MENARD_RUNTIME_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* One 64-bit machine word: an immediate or a pointer, per spec §2.2. */
typedef uint64_t MnWord;

/*
 * The empty word — 0. Not a reference to anything; the only even word that
 * is not the address of an object or a function (spec §2.2, "the empty
 * word"). `mn_alloc` zeroes every body it hands out, so an unwritten slot
 * always reads as this — after the shape header is written.
 */
#define MN_EMPTY ((MnWord)0)

/*
 * Layout kinds (spec §2.2.1): how the collector would read the object.
 * Phase 3 stores these in shape descriptors; the collector itself is
 * Phase 4.
 */
#define MN_LAYOUT_ORDINARY 0
#define MN_LAYOUT_CLOSURE 1
#define MN_LAYOUT_BYTES 2

/* Location is a second axis from layout (spec §2.2.1). Omitted
 * designated-initializer fields stay 0, i.e. heap. */
#define MN_LOC_HEAP 0
#define MN_LOC_STATIC 1

/*
 * Static shape descriptor — one per constructor (spec §2.2.1). The
 * object's first word is a pointer to one of these. Static objects are
 * leaves: not marked, not swept, not moved.
 */
typedef struct MnShape {
  int32_t tag;      /* constructor tag id */
  int32_t nbytes;   /* total object size including the header word */
  int32_t layout;   /* MN_LAYOUT_ORDINARY / CLOSURE / BYTES */
  int32_t location; /* MN_LOC_HEAP / MN_LOC_STATIC */
} MnShape;

/*
 * `Int` is 63-bit signed, tagged in the low bit: t(v) = (v << 1) | 1, held
 * in an `i64` (spec §2.2, "why Int is 63 bits"). `+` and `-` are exact on
 * the tagged form directly; multiply, divide and shift must untag, operate
 * on the native width, and retag — see the spec's arithmetic rules. These
 * two functions are the tag/untag primitives only.
 */
static inline MnWord mn_int_to_word(int64_t v) {
  return (MnWord)(((uint64_t)v << 1) | (uint64_t)1);
}

static inline int64_t mn_word_to_int(MnWord w) {
  /* Arithmetic right shift on the signed reinterpretation sign-extends,
   * recovering the original 63-bit value. */
  return ((int64_t)w) >> 1;
}

/*
 * Bool / Unit immediates (spec §2.2: tagged immediates; bit patterns left
 * unspecified). Int already occupies every odd residue via t(v)=(v<<1)|1,
 * so Bool/Unit share the OCaml-style type-erased encodings:
 *   false = t(0) = 1, true = t(1) = 3, Unit = t(0) = 1.
 * The type system keeps them apart; the host never models tags.
 */
#define MN_FALSE ((MnWord)1)
#define MN_TRUE ((MnWord)3)
#define MN_UNIT ((MnWord)1)

/* Odd => immediate (spec invariant 1); even => pointer (invariant 2). */
static inline int mn_is_immediate(MnWord w) {
  return (int)(w & (MnWord)1);
}

/*
 * mn_alloc — allocate `size` bytes, 8-byte aligned, zeroed, then store
 * `shape` at offset 0.
 *
 * `size` includes the header word (8 bytes) plus the payload. The
 * returned pointer is the object itself (even, 8-byte aligned) — slot 0
 * holds the shape pointer; payload slots begin at offset 8.
 *
 * Panics (does not return NULL) if `size` is negative or smaller than
 * one header word, or if the heap cannot grow. May collect, and may
 * move every heap object reachable from the shadow stack.
 */
void *mn_alloc(int64_t size, void *shape);

/*
 * mn_realloc — replace a `bytes` payload. The payload may move; the
 * holder stores the returned pointer and never an interior one. `old`
 * is the payload pointer previously returned (or NULL).
 */
void *mn_realloc(void *old_payload, int64_t size);

/* Stop-the-world collection entry points (spec §4.4). */
void mn_gc_collect(void);
void mn_gc_stats(void);

/*
 * Write `value` into `slot` of heap object `holder`. If `holder` is in
 * old space and `value` points into the nursery, record `holder` in the
 * remembered set so a minor collection can find the pointer without
 * scanning old space.
 */
void mn_gc_store(void *holder, MnWord *slot, MnWord value);

/*
 * Shadow stack (spec §4.4). `mn_root_push` writes the empty word into
 * `slot`, then pushes the slot's address. The mutator stores the real
 * word afterwards. `mn_root_pop` pops one slot.
 *
 * `mn_root_keep` / `mn_root_get` are the lowering ABI: keep a word in a
 * fresh slot and return a tagged index; get reloads the (possibly
 * moved) word. `mn_root_save` / `mn_root_restore` bracket loops and
 * calls so `recur` can pop before it jumps.
 */
void mn_root_push(void *slot);
void mn_root_pop(void);
MnWord mn_root_push_word(MnWord slot_bits);
MnWord mn_root_keep(MnWord value);
MnWord mn_root_get(MnWord index_tagged);
MnWord mn_root_save(void);
MnWord mn_root_restore(MnWord depth_tagged);

/* Load the shape pointer stored at offset 0 of an object. */
static inline MnShape *mn_obj_shape(void *ptr) {
  return *(MnShape **)ptr;
}

/*
 * mn_panic — the runtime's terminal failure path. Writes `message` to fd 2
 * (spec §2.16: flush stderr before panic) and terminates the process.
 * Never returns.
 */
_Noreturn void mn_panic(const char *message);

/*
 * Menard call stack for panics. The compiler pushes the caller's file and
 * line before each call and pops after it returns. `mn_panic_at` prints
 * `file:line: panic: message` and then those frames, innermost caller first.
 */
void mn_trace_push(const char *file, int64_t line);
void mn_trace_pop(void);
_Noreturn void mn_panic_at(const char *file, int64_t line, const char *message);

/*
 * mn_write_stdout — write `n` raw bytes to fd 1 (`runtime/src/print.c`).
 * fd 1 carries only the compiled program's own output (spec §2.16) —
 * never a panic message, which always goes through `mn_panic` to fd 2
 * instead.
 */
void mn_write_stdout(const uint8_t *p, size_t n);

/*
 * mn_write_stderr — write `n` raw bytes to fd 2 (`runtime/src/print.c`),
 * mirroring `mn_write_stdout`'s fd-1 loop exactly.
 */
void mn_write_stderr(const uint8_t *p, size_t n);

/*
 * mn_print_i64 — write `v`'s decimal representation (no trailing
 * newline) to fd 1 via `mn_write_stdout`.
 */
void mn_print_i64(int64_t v);

/* Same stack as `mn_root_push` / `mn_root_pop`. */
void mn_shadow_push(void *slot);
void mn_shadow_pop(void);

/*
 * Builtin List / Maybe / Result constructors and match helpers
 * (`runtime/src/variants.c`, Phase 3 slice C). All values are MnWord.
 */
MnWord mn_nil(void);
MnWord mn_cons(MnWord head, MnWord tail);
MnWord mn_none(void);
MnWord mn_some(MnWord x);
MnWord mn_ok(MnWord x);
MnWord mn_err(MnWord e);
int64_t mn_tag(MnWord obj);
MnWord mn_slot(MnWord obj, int64_t i);
/* User nominals (slice H): allocate + fill ordinary heap objects. */
MnWord mn_new(int64_t tag, int64_t nslots);
MnWord mn_set_slot(MnWord obj, int64_t i, MnWord v);

/* Str / StringBuffer / Ref (`runtime/src/str.c`, Phase 3 slice D). */
MnWord mn_str_new(int64_t ptr_bits, int64_t len);
MnWord mn_str_concat(MnWord a, MnWord b);
MnWord mn_str_byte_length(MnWord s);
MnWord mn_str_byte(MnWord s, MnWord i_tagged);
MnWord mn_str_slice(MnWord s, MnWord start_t, MnWord end_t);
void mn_print_str(MnWord s);
/* `(write fd s)` when `fd` or `s` is not a literal. `fd` is a tagged Int, 1 or 2. Returns Unit. */
MnWord mn_write(MnWord fd_tagged, MnWord s);
MnWord mn_ref_new(MnWord v);
MnWord mn_ref_deref(MnWord r);
MnWord mn_ref_set(MnWord r, MnWord v);
MnWord mn_sb_new(void);
MnWord mn_sb_length(MnWord sb);
MnWord mn_sb_append(MnWord sb, MnWord s);
MnWord mn_sb_append_byte(MnWord sb, MnWord b_tagged);
MnWord mn_sb_take_str(MnWord sb);
MnWord mn_sb_to_str(MnWord sb);
/*
 * Module slots. A non-integer top-level `let` is evaluated once from the
 * module init and stored here; other functions load it by the same key.
 * The key is the bytes of an immortal string global (pointer bits + length),
 * the same shape `mn_str_new` takes. `mn_slot_get` panics if the key was
 * never stored. The value word is a GC root for the life of the process.
 */
MnWord mn_slot_get(int64_t key_ptr_bits, int64_t len);
MnWord mn_slot_set(int64_t key_ptr_bits, int64_t len, MnWord value);

/* Loose `show` for diagnostics (Phase 3 slice H) — Int decimal or #<obj>. */
MnWord mn_show(MnWord v);
MnWord mn_float_from_str(int64_t ptr_bits, int64_t len);
MnWord mn_fadd(MnWord a, MnWord b);
MnWord mn_fsub(MnWord a, MnWord b);
MnWord mn_fmul(MnWord a, MnWord b);
MnWord mn_fdiv(MnWord a, MnWord b);
/* `(dump v)` is a diagnostic builtin. The fixed-point emit never calls it;
 * a Unit no-op keeps the call lowerable without an AST printer. */
MnWord mn_dump(MnWord v);

/* Value-directed equality and ordering (`runtime/src/equal.c`). */
MnWord mn_equal(MnWord a, MnWord b);   /* → Bool */
MnWord mn_compare(MnWord a, MnWord b); /* → Int, <0 / 0 / >0 */

/* Persistent Map (`runtime/src/map.c`, Phase 3 slice F). */
MnWord mn_map_new(void);
MnWord mn_map_set(MnWord m, MnWord k, MnWord v);
MnWord mn_map_get(MnWord m, MnWord k); /* → (Maybe v) as Some/None */
MnWord mn_map_has(MnWord m, MnWord k); /* → Bool */
MnWord mn_map_size(MnWord m);          /* → Int */

/* Heap closures (`runtime/src/closure.c`, Phase 3 slice E). */
MnWord mn_env_0(void);
MnWord mn_env_1(MnWord a);
MnWord mn_env_new(MnWord n_tagged);
MnWord mn_env_set(MnWord env, MnWord i_tagged, MnWord v);
MnWord mn_env_get(MnWord env, MnWord i_tagged);
MnWord mn_closure_new(MnWord code_bits, MnWord env);
MnWord mn_closure_bare(MnWord code_bits); /* top-level fn as value; apply without env */
MnWord mn_ctor_closure(MnWord tag_raw, MnWord arity_raw); /* constructor as Fn value */
MnWord mn_apply_0(MnWord clo);
MnWord mn_apply_1(MnWord clo, MnWord a0);
MnWord mn_apply_2(MnWord clo, MnWord a0, MnWord a1);

/*
 * Tier-0 I/O (`runtime/src/io.c`, Phase 3 slice G). Emitted `@main` is
 * `i32(i32 argc, ptr argv)` and must call `mn_init` before any of the
 * arg / file helpers. `mn_init` drops the process name, so `(arg 0)` is
 * the first user argument. `mn_read_file` / `mn_write_file` return
 * `(Result … IoError)` via `mn_ok` / `mn_err`.
 */
void mn_init(int argc, char **argv);
MnWord mn_arg_count(void);
MnWord mn_arg(MnWord i_tagged); /* → Str; panics if out of range */
MnWord mn_read_file(MnWord path_str); /* → (Result Str IoError) */
MnWord mn_write_file(MnWord path_str, MnWord content_str); /* → (Result Unit IoError) */
_Noreturn void mn_exit(MnWord code_tagged);
/* `(spawn argv)` — posix_spawn, inherited stdio and cwd, no PATH search.
 * → (Result SpawnStatus IoError). Exited tag 30, Signalled tag 31. */
MnWord mn_spawn(MnWord argv_list);
/* `(spawn-capture argv stdin)` — same argv rules, pipes for stdin/stdout/stderr.
 * → (Result SpawnOutput SpawnError). SpawnOutput tag 32. A bare command
 * name is `./name`. */
MnWord mn_spawn_capture(MnWord argv_list, MnWord stdin_str);
MnWord mn_getenv(MnWord name);                 /* → (Maybe Str) */
MnWord mn_exists(MnWord path_str);             /* → Bool */
MnWord mn_rename(MnWord from_str, MnWord to_str); /* → (Result Unit IoError) */
/* Cache and diagnostics seam. Paths are Menard strings. mtime is
 * milliseconds since the epoch, or 0 when the path is missing. */
MnWord mn_isatty(MnWord fd_tagged);            /* → Bool */
MnWord mn_mtime(MnWord path_str);              /* → Int */
MnWord mn_cwd(void);                           /* → Str */
MnWord mn_ensure_dir(MnWord path_str);         /* → Bool; mkdir -p */
MnWord mn_list_dir(MnWord path_str);           /* → Str; newline-separated */
MnWord mn_realpath(MnWord path_str);           /* → Str; empty on failure */
MnWord mn_now_ms(void);                        /* → Int */
MnWord mn_remove(MnWord path_str);             /* → Bool */
MnWord mn_is_dir(MnWord path_str);             /* → Bool */

#ifdef __cplusplus
}
#endif

#endif /* MENARD_RUNTIME_H */
