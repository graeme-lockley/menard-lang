/*
 * Builtin variant / List constructors and accessors (Phase 3 slice C).
 *
 * Nullaries (Nil, None) are static pool objects — one header word each.
 * Payload constructors allocate via mn_alloc and store slots after the
 * shape header. `mn_tag` / `mn_slot` are what `match` lowering calls.
 */
#include "menard.h"

#include <stdint.h>
#include <stdlib.h>

/* Constructor tags — must match src/emit/lower.mnd's tag constants. */
#define TAG_NIL 0
#define TAG_CONS 1
#define TAG_NONE 2
#define TAG_SOME 3
#define TAG_OK 4
#define TAG_ERR 5

#define HDR ((int64_t)sizeof(void *)) /* 8 */

static MnShape shape_nil = {.tag = TAG_NIL, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_cons = {.tag = TAG_CONS, .nbytes = 24, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_none = {.tag = TAG_NONE, .nbytes = 8, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_some = {.tag = TAG_SOME, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_ok = {.tag = TAG_OK, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_err = {.tag = TAG_ERR, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};

/* Static nullary pool objects — header only. */
static struct {
  MnShape *shape;
} mn_static_nil = {.shape = &shape_nil};

static struct {
  MnShape *shape;
} mn_static_none = {.shape = &shape_none};

MnWord mn_nil(void) { return (MnWord)&mn_static_nil; }
MnWord mn_none(void) { return (MnWord)&mn_static_none; }

MnWord mn_cons(MnWord head, MnWord tail) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 16, &shape_cons);
  obj[1] = head;
  obj[2] = tail;
  return (MnWord)obj;
}

MnWord mn_some(MnWord x) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_some);
  obj[1] = x;
  return (MnWord)obj;
}

MnWord mn_ok(MnWord x) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_ok);
  obj[1] = x;
  return (MnWord)obj;
}

MnWord mn_err(MnWord e) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_err);
  obj[1] = e;
  return (MnWord)obj;
}

/* Untagged constructor tag (machine i64) for icmp/switch in match. */
int64_t mn_tag(MnWord obj) {
  if (mn_is_immediate(obj)) {
    mn_panic("mn_tag: immediate is not a heap/static object");
  }
  MnShape *sh = mn_obj_shape((void *)(uintptr_t)obj);
  return (int64_t)sh->tag;
}

/* Payload slot `i` (0-based), as a Menard word. */
MnWord mn_slot(MnWord obj, int64_t i) {
  if (mn_is_immediate(obj)) {
    mn_panic("mn_slot: immediate is not a heap/static object");
  }
  if (i < 0) {
    mn_panic("mn_slot: negative index");
  }
  MnWord *p = (MnWord *)(uintptr_t)obj;
  return p[1 + i];
}

/*
 * Generic user-nominal constructor (slice H). `tag` / `nslots` are plain
 * machine i64s (same convention as `mn_slot`'s index). Shape descriptors
 * are malloc'd and leaked — Phase 3 has no collector.
 */
MnWord mn_new(int64_t tag, int64_t nslots) {
  if (nslots < 0) {
    mn_panic("mn_new: negative nslots");
  }
  int64_t nbytes = HDR + nslots * (int64_t)sizeof(MnWord);
  MnShape *sh = (MnShape *)malloc(sizeof(MnShape));
  if (sh == NULL) {
    mn_panic("mn_new: shape malloc failed");
  }
  sh->tag = (int32_t)tag;
  sh->nbytes = (int32_t)nbytes;
  sh->layout = MN_LAYOUT_ORDINARY;
  MnWord *obj = (MnWord *)mn_alloc(nbytes, sh);
  return (MnWord)obj;
}

MnWord mn_set_slot(MnWord obj, int64_t i, MnWord v) {
  if (mn_is_immediate(obj)) {
    mn_panic("mn_set_slot: immediate is not a heap/static object");
  }
  if (i < 0) {
    mn_panic("mn_set_slot: negative index");
  }
  MnWord *p = (MnWord *)(uintptr_t)obj;
  p[1 + i] = v;
  return obj;
}
