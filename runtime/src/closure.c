/*
 * Heap closures (Phase 3 slice E, spec §2.6).
 *
 * Layout (MN_LAYOUT_CLOSURE): header | code-ptr-as-word | env-ptr
 * Env is an ordinary object: header | slot0 | slot1 | …
 * Apply helpers cast slot0 back to a C function pointer and call it.
 */
#include "menard.h"

#include <stdint.h>
#include <stdlib.h>

#define HDR ((int64_t)sizeof(void *))
#define TAG_CLOSURE 100
#define TAG_ENV 101

static MnShape shape_closure = {
    .tag = TAG_CLOSURE, .nbytes = 24, .layout = MN_LAYOUT_CLOSURE};
static MnShape shape_env1 = {
    .tag = TAG_ENV, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_env0 = {
    .tag = TAG_ENV, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY};

typedef MnWord (*mn_fn0)(MnWord env);
typedef MnWord (*mn_fn1)(MnWord env, MnWord a0);
typedef MnWord (*mn_fn2)(MnWord env, MnWord a0, MnWord a1);
typedef MnWord (*mn_bare0)(void);
typedef MnWord (*mn_bare1)(MnWord a0);
typedef MnWord (*mn_bare2)(MnWord a0, MnWord a1);

/* Sentinel env: closure code is a bare top-level function (no env arg). */
static MnShape shape_bare = {
    .tag = 102, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY, .location = MN_LOC_STATIC};
static struct {
  MnShape *shape;
} __attribute__((aligned(8))) mn_bare_marker = {.shape = &shape_bare};

static int mn_env_is_bare(MnWord env) {
  return env == (MnWord)&mn_bare_marker;
}

MnWord mn_closure_bare(MnWord code_bits) {
  return mn_closure_new(code_bits, (MnWord)&mn_bare_marker);
}

MnWord mn_env_0(void) {
  MnWord *obj = (MnWord *)mn_alloc(HDR, &shape_env0);
  return (MnWord)obj;
}

MnWord mn_env_1(MnWord a) {
  MnWord as;
  mn_root_push(&as);
  as = a;
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_env1);
  mn_gc_store(obj, &obj[1], as);
  mn_root_pop();
  return (MnWord)obj;
}

/* N-slot env. `n` and `i` are tagged Ints (same convention as mn_env_get). */
MnWord mn_env_new(MnWord n_tagged) {
  int64_t n = mn_word_to_int(n_tagged);
  if (n < 0) {
    mn_panic("mn_env_new: negative size");
  }
  int64_t nbytes = HDR + n * (int64_t)sizeof(MnWord);
  MnShape *sh = (MnShape *)malloc(sizeof(MnShape));
  if (sh == NULL) {
    mn_panic("mn_env_new: malloc failed");
  }
  sh->tag = TAG_ENV;
  sh->nbytes = (int32_t)nbytes;
  sh->layout = MN_LAYOUT_ORDINARY;
  sh->location = MN_LOC_HEAP;
  return (MnWord)mn_alloc(nbytes, sh);
}

MnWord mn_env_set(MnWord env, MnWord i_tagged, MnWord v) {
  int64_t i = mn_word_to_int(i_tagged);
  if (mn_is_immediate(env)) {
    mn_panic("mn_env_set: env is immediate");
  }
  if (i < 0) {
    mn_panic("mn_env_set: negative index");
  }
  MnWord *obj = (MnWord *)(uintptr_t)env;
  mn_gc_store(obj, &obj[1 + i], v);
  return env;
}

MnWord mn_env_get(MnWord env, MnWord i_tagged) {
  int64_t i = mn_word_to_int(i_tagged);
  if (mn_is_immediate(env)) {
    mn_panic("mn_env_get: env is immediate");
  }
  MnWord *obj = (MnWord *)(uintptr_t)env;
  return obj[1 + i];
}

/* code_bits is the bit pattern of a function pointer (ptrtoint). */
MnWord mn_closure_new(MnWord code_bits, MnWord env) {
  MnWord es;
  mn_root_push(&es);
  es = env;
  MnWord *obj = (MnWord *)mn_alloc(HDR + 16, &shape_closure);
  obj[1] = code_bits; /* code pointer: closure layout does not trace slot 0 */
  mn_gc_store(obj, &obj[2], es);
  mn_root_pop();
  return (MnWord)obj;
}

MnWord mn_apply_0(MnWord clo) {
  if (mn_is_immediate(clo)) {
    mn_panic("mn_apply_0: not a closure");
  }
  MnWord *obj = (MnWord *)(uintptr_t)clo;
  MnWord env = obj[2];
  if (mn_env_is_bare(env)) {
    return ((mn_bare0)(uintptr_t)obj[1])();
  }
  return ((mn_fn0)(uintptr_t)obj[1])(env);
}

MnWord mn_apply_1(MnWord clo, MnWord a0) {
  if (mn_is_immediate(clo)) {
    mn_panic("mn_apply_1: not a closure");
  }
  MnWord *obj = (MnWord *)(uintptr_t)clo;
  MnWord env = obj[2];
  if (mn_env_is_bare(env)) {
    return ((mn_bare1)(uintptr_t)obj[1])(a0);
  }
  return ((mn_fn1)(uintptr_t)obj[1])(env, a0);
}

MnWord mn_apply_2(MnWord clo, MnWord a0, MnWord a1) {
  if (mn_is_immediate(clo)) {
    mn_panic("mn_apply_2: not a closure");
  }
  MnWord *obj = (MnWord *)(uintptr_t)clo;
  MnWord env = obj[2];
  if (mn_env_is_bare(env)) {
    return ((mn_bare2)(uintptr_t)obj[1])(a0, a1);
  }
  return ((mn_fn2)(uintptr_t)obj[1])(env, a0, a1);
}

/* Constructor-as-value: env holds (tag, arity) as raw i64 words in slots. */
/* Tag and arity are raw machine words, not Menard pointers. */
static MnShape shape_ctor_env = {
    .tag = 103, .nbytes = 24, .layout = MN_LAYOUT_BYTES};

static MnWord ctor_apply_0(MnWord env) {
  MnWord *e = (MnWord *)(uintptr_t)env;
  return mn_new((int64_t)e[1], (int64_t)e[2]);
}

static MnWord ctor_apply_1(MnWord env, MnWord a0) {
  MnWord es, as;
  mn_root_push(&es);
  es = env;
  mn_root_push(&as);
  as = a0;
  MnWord *e = (MnWord *)(uintptr_t)es;
  MnWord obj = mn_new((int64_t)e[1], (int64_t)e[2]);
  obj = mn_set_slot(obj, 0, as);
  mn_root_pop();
  mn_root_pop();
  return obj;
}

static MnWord ctor_apply_2(MnWord env, MnWord a0, MnWord a1) {
  MnWord es, a0s, a1s;
  mn_root_push(&es);
  es = env;
  mn_root_push(&a0s);
  a0s = a0;
  mn_root_push(&a1s);
  a1s = a1;
  MnWord *e = (MnWord *)(uintptr_t)es;
  MnWord obj = mn_new((int64_t)e[1], (int64_t)e[2]);
  obj = mn_set_slot(obj, 0, a0s);
  obj = mn_set_slot(obj, 1, a1s);
  mn_root_pop();
  mn_root_pop();
  mn_root_pop();
  return obj;
}

MnWord mn_ctor_closure(MnWord tag_raw, MnWord arity_raw) {
  int64_t ar = (int64_t)arity_raw;
  MnWord *env = (MnWord *)mn_alloc(HDR + 16, &shape_ctor_env);
  env[1] = tag_raw;
  env[2] = arity_raw;
  MnWord held;
  mn_root_push(&held);
  held = (MnWord)env;
  MnWord code;
  if (ar == 0) {
    code = (MnWord)(uintptr_t)ctor_apply_0;
  } else if (ar == 1) {
    code = (MnWord)(uintptr_t)ctor_apply_1;
  } else if (ar == 2) {
    code = (MnWord)(uintptr_t)ctor_apply_2;
  } else {
    mn_panic("mn_ctor_closure: arity > 2 not supported yet");
  }
  MnWord clo = mn_closure_new(code, held);
  mn_root_pop();
  return clo;
}
