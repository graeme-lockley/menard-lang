/*
 * Str / StringBuffer / Ref runtime (Phase 3 slice D).
 *
 * Str is a `bytes`-kind object: shape | len | bytes…
 * Ref is ordinary: shape | one slot
 * StringBuffer is ordinary: shape | data-ptr | len | cap  (data is a
 * malloc'd byte buffer, not a Menard object — Phase 3 leaks).
 */
#include "menard.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define HDR ((int64_t)sizeof(void *))
#define TAG_STR 10
#define TAG_REF 11
#define TAG_SB 12
#define TAG_FLOAT 13

static MnShape shape_str = {.tag = TAG_STR, .nbytes = 16, .layout = MN_LAYOUT_BYTES};
/* Bytes: the f64 payload is not a Menard pointer. */
static MnShape shape_float = {.tag = TAG_FLOAT, .nbytes = 16, .layout = MN_LAYOUT_BYTES};
static MnShape shape_ref = {.tag = TAG_REF, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};
/* Bytes: the data pointer, length, and capacity are not Menard pointers. */
static MnShape shape_sb = {.tag = TAG_SB, .nbytes = 32, .layout = MN_LAYOUT_BYTES};

/* ptr_bits is a raw pointer bit-pattern (from ptrtoint of a string global). */
MnWord mn_str_new(int64_t ptr_bits, int64_t len) {
  if (len < 0) {
    mn_panic("mn_str_new: negative length");
  }
  const uint8_t *src = (const uint8_t *)(uintptr_t)ptr_bits;
  int64_t total = HDR + 8 + len;
  MnWord *obj = (MnWord *)mn_alloc(total, &shape_str);
  obj[1] = (MnWord)len;
  if (len > 0 && src != NULL) {
    memcpy((uint8_t *)(obj + 2), src, (size_t)len);
  }
  return (MnWord)obj;
}

static int64_t str_len(MnWord s) {
  if (mn_is_immediate(s)) {
    mn_panic("mn_str: expected Str object");
  }
  return (int64_t)((MnWord *)(uintptr_t)s)[1];
}

static uint8_t *str_bytes(MnWord s) {
  return (uint8_t *)(((MnWord *)(uintptr_t)s) + 2);
}

MnWord mn_str_concat(MnWord a, MnWord b) {
  MnWord as, bs;
  mn_root_push(&as);
  as = a;
  mn_root_push(&bs);
  bs = b;
  int64_t la = str_len(as);
  int64_t lb = str_len(bs);
  int64_t n = la + lb;
  int64_t total = HDR + 8 + n;
  MnWord *obj = (MnWord *)mn_alloc(total, &shape_str);
  la = str_len(as);
  lb = str_len(bs);
  obj[1] = (MnWord)(la + lb);
  uint8_t *dst = (uint8_t *)(obj + 2);
  if (la > 0) {
    memcpy(dst, str_bytes(as), (size_t)la);
  }
  if (lb > 0) {
    memcpy(dst + la, str_bytes(bs), (size_t)lb);
  }
  mn_root_pop();
  mn_root_pop();
  return (MnWord)obj;
}

MnWord mn_str_byte_length(MnWord s) { return mn_int_to_word(str_len(s)); }

MnWord mn_str_byte(MnWord s, MnWord i_tagged) {
  int64_t i = mn_word_to_int(i_tagged);
  int64_t n = str_len(s);
  if (i < 0 || i >= n) {
    mn_panic("mn_str_byte: index out of range");
  }
  return mn_int_to_word((int64_t)str_bytes(s)[i]);
}

MnWord mn_str_slice(MnWord s, MnWord start_t, MnWord len_t) {
  MnWord ss;
  mn_root_push(&ss);
  ss = s;
  int64_t start = mn_word_to_int(start_t);
  int64_t len = mn_word_to_int(len_t);
  int64_t n = str_len(ss);
  /* `(str-slice s start len)` — length, matching the interpreter. */
  if (start < 0) {
    start = 0;
  }
  if (start > n) {
    start = n;
  }
  if (len < 0) {
    len = 0;
  }
  if (start + len > n) {
    len = n - start;
  }
  int64_t total = HDR + 8 + len;
  MnWord *obj = (MnWord *)mn_alloc(total, &shape_str);
  n = str_len(ss);
  if (start > n) {
    start = n;
  }
  if (start + len > n) {
    len = n - start;
  }
  obj[1] = (MnWord)len;
  if (len > 0) {
    memcpy((uint8_t *)(obj + 2), str_bytes(ss) + start, (size_t)len);
  }
  mn_root_pop();
  return (MnWord)obj;
}

void mn_print_str(MnWord s) {
  int64_t n = str_len(s);
  if (n > 0) {
    mn_write_stdout(str_bytes(s), (size_t)n);
  }
}

MnWord mn_ref_new(MnWord v) {
  MnWord vs;
  mn_root_push(&vs);
  vs = v;
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_ref);
  mn_gc_store(obj, &obj[1], vs);
  mn_root_pop();
  return (MnWord)obj;
}

MnWord mn_ref_deref(MnWord r) {
  if (mn_is_immediate(r)) {
    mn_panic("mn_ref_deref: expected Ref");
  }
  return ((MnWord *)(uintptr_t)r)[1];
}

MnWord mn_ref_set(MnWord r, MnWord v) {
  if (mn_is_immediate(r)) {
    mn_panic("mn_ref_set: expected Ref");
  }
  MnWord *obj = (MnWord *)(uintptr_t)r;
  mn_gc_store(obj, &obj[1], v);
  return MN_UNIT;
}

MnWord mn_sb_new(void) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 24, &shape_sb);
  int64_t cap = 16;
  uint8_t *buf = (uint8_t *)malloc((size_t)cap);
  if (buf == NULL) {
    mn_panic("mn_sb_new: malloc failed");
  }
  obj[1] = (MnWord)(uintptr_t)buf;
  obj[2] = 0;   /* len */
  obj[3] = (MnWord)cap;
  return (MnWord)obj;
}

static void sb_grow(MnWord *obj, int64_t need) {
  int64_t cap = (int64_t)obj[3];
  if (need <= cap) {
    return;
  }
  while (cap < need) {
    cap = cap < 1 ? 16 : cap * 2;
  }
  uint8_t *buf = (uint8_t *)realloc((void *)(uintptr_t)obj[1], (size_t)cap);
  if (buf == NULL) {
    mn_panic("mn_sb_grow: realloc failed");
  }
  obj[1] = (MnWord)(uintptr_t)buf;
  obj[3] = (MnWord)cap;
}

MnWord mn_sb_length(MnWord sb) {
  if (mn_is_immediate(sb)) {
    mn_panic("mn_sb_length: expected StringBuffer");
  }
  return mn_int_to_word((int64_t)((MnWord *)(uintptr_t)sb)[2]);
}

MnWord mn_sb_append(MnWord sb, MnWord s) {
  if (mn_is_immediate(sb)) {
    mn_panic("mn_sb_append: expected StringBuffer");
  }
  MnWord *obj = (MnWord *)(uintptr_t)sb;
  int64_t len = (int64_t)obj[2];
  int64_t n = str_len(s);
  sb_grow(obj, len + n);
  if (n > 0) {
    memcpy((uint8_t *)(uintptr_t)obj[1] + len, str_bytes(s), (size_t)n);
  }
  obj[2] = (MnWord)(len + n);
  return MN_UNIT;
}

MnWord mn_sb_append_byte(MnWord sb, MnWord b_tagged) {
  if (mn_is_immediate(sb)) {
    mn_panic("mn_sb_append_byte: expected StringBuffer");
  }
  MnWord *obj = (MnWord *)(uintptr_t)sb;
  int64_t len = (int64_t)obj[2];
  int64_t byte = mn_word_to_int(b_tagged) & 255;
  sb_grow(obj, len + 1);
  ((uint8_t *)(uintptr_t)obj[1])[len] = (uint8_t)byte;
  obj[2] = (MnWord)(len + 1);
  return MN_UNIT;
}

MnWord mn_sb_take_str(MnWord sb) {
  if (mn_is_immediate(sb)) {
    mn_panic("mn_sb_take_str: expected StringBuffer");
  }
  MnWord held;
  mn_root_push(&held);
  held = sb;
  MnWord *obj = (MnWord *)(uintptr_t)held;
  int64_t len = (int64_t)obj[2];
  int64_t total = HDR + 8 + len;
  MnWord *str = (MnWord *)mn_alloc(total, &shape_str);
  obj = (MnWord *)(uintptr_t)held;
  len = (int64_t)obj[2];
  str[1] = (MnWord)len;
  if (len > 0) {
    memcpy((uint8_t *)(str + 2), (uint8_t *)(uintptr_t)obj[1], (size_t)len);
  }
  obj[2] = 0;
  mn_root_pop();
  return (MnWord)str;
}

MnWord mn_sb_to_str(MnWord sb) {
  if (mn_is_immediate(sb)) {
    mn_panic("mn_sb_to_str: expected StringBuffer");
  }
  MnWord held;
  mn_root_push(&held);
  held = sb;
  MnWord *obj = (MnWord *)(uintptr_t)held;
  int64_t len = (int64_t)obj[2];
  int64_t total = HDR + 8 + len;
  MnWord *str = (MnWord *)mn_alloc(total, &shape_str);
  obj = (MnWord *)(uintptr_t)held;
  len = (int64_t)obj[2];
  str[1] = (MnWord)len;
  if (len > 0) {
    memcpy((uint8_t *)(str + 2), (uint8_t *)(uintptr_t)obj[1], (size_t)len);
  }
  mn_root_pop();
  return (MnWord)str;
}

static MnWord box_float(double d) {
  MnWord *obj = (MnWord *)mn_alloc(16, &shape_float);
  memcpy(&obj[1], &d, sizeof(d));
  return (MnWord)obj;
}

static double unbox_float(MnWord w) {
  double d = 0;
  if (!mn_is_immediate(w)) {
    memcpy(&d, &((MnWord *)(uintptr_t)w)[1], sizeof(d));
  }
  return d;
}

MnWord mn_float_from_str(int64_t ptr_bits, int64_t len) {
  if (len < 0) {
    mn_panic("mn_float_from_str: negative length");
  }
  char *tmp = (char *)malloc((size_t)len + 1);
  if (tmp == NULL) {
    mn_panic("mn_float_from_str: out of memory");
  }
  if (len > 0) {
    memcpy(tmp, (const void *)(uintptr_t)ptr_bits, (size_t)len);
  }
  tmp[len] = 0;
  char *end = NULL;
  double d = strtod(tmp, &end);
  free(tmp);
  return box_float(d);
}

MnWord mn_fadd(MnWord a, MnWord b) { return box_float(unbox_float(a) + unbox_float(b)); }
MnWord mn_fsub(MnWord a, MnWord b) { return box_float(unbox_float(a) - unbox_float(b)); }
MnWord mn_fmul(MnWord a, MnWord b) { return box_float(unbox_float(a) * unbox_float(b)); }
MnWord mn_fdiv(MnWord a, MnWord b) { return box_float(unbox_float(a) / unbox_float(b)); }

static int format_float(double d, char *buf, size_t n) {
  if (d == 0.0) {
    if (signbit(d)) return snprintf(buf, n, "-0.0");
    return snprintf(buf, n, "0.0");
  }
  if (isfinite(d) && d == trunc(d) && d < 1e15 && d > -1e15) {
    return snprintf(buf, n, "%.1f", d);
  }
  return snprintf(buf, n, "%.15g", d);
}

MnWord mn_show(MnWord v) {
  char buf[64];
  int n;
  if (mn_is_immediate(v)) {
    /* Int / Bool / Unit share odd immediates; print as Int decimal. */
    n = snprintf(buf, sizeof(buf), "%lld", (long long)mn_word_to_int(v));
  } else {
    MnWord *obj = (MnWord *)(uintptr_t)v;
    MnShape *sh = (MnShape *)(uintptr_t)obj[0];
    if (sh != NULL && sh->tag == TAG_FLOAT) {
      n = format_float(unbox_float(v), buf, sizeof(buf));
    } else if (sh != NULL && sh->tag == TAG_STR) {
      int64_t len = str_len(v);
      if (len < 0 || (uint64_t)len > (SIZE_MAX - 2) / 2) {
        mn_panic("mn_show: string too large");
      }
      uint8_t *quoted = malloc((size_t)len * 2 + 2);
      if (quoted == NULL) {
        mn_panic("mn_show: out of memory");
      }
      size_t at = 0;
      quoted[at++] = '"';
      const uint8_t *bytes = str_bytes(v);
      for (int64_t i = 0; i < len; i++) {
        if (bytes[i] == '\\' || bytes[i] == '"') quoted[at++] = '\\';
        quoted[at++] = bytes[i];
      }
      quoted[at++] = '"';
      MnWord result = mn_str_new((int64_t)(uintptr_t)quoted, (int64_t)at);
      free(quoted);
      return result;
    } else {
      n = snprintf(buf, sizeof(buf), "#<obj>");
    }
  }
  if (n < 0) {
    mn_panic("mn_show: snprintf failed");
  }
  return mn_str_new((int64_t)(uintptr_t)buf, (int64_t)n);
}

MnWord mn_dump(MnWord v) {
  (void)v;
  return MN_UNIT;
}
