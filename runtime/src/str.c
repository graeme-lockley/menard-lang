/*
 * Str / StringBuffer / Ref runtime (Phase 3 slice D).
 *
 * Str is a `bytes`-kind object: shape | len | bytes…
 * Ref is ordinary: shape | one slot
 * StringBuffer is ordinary: shape | data-ptr | len | cap  (data is a
 * malloc'd byte buffer, not a Menard object — Phase 3 leaks).
 */
#include "menard.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define HDR ((int64_t)sizeof(void *))
#define TAG_STR 10
#define TAG_REF 11
#define TAG_SB 12

static MnShape shape_str = {.tag = TAG_STR, .nbytes = 16, .layout = MN_LAYOUT_BYTES};
static MnShape shape_ref = {.tag = TAG_REF, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};
static MnShape shape_sb = {.tag = TAG_SB, .nbytes = 32, .layout = MN_LAYOUT_ORDINARY};

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
  int64_t la = str_len(a);
  int64_t lb = str_len(b);
  int64_t n = la + lb;
  int64_t total = HDR + 8 + n;
  MnWord *obj = (MnWord *)mn_alloc(total, &shape_str);
  obj[1] = (MnWord)n;
  uint8_t *dst = (uint8_t *)(obj + 2);
  if (la > 0) {
    memcpy(dst, str_bytes(a), (size_t)la);
  }
  if (lb > 0) {
    memcpy(dst + la, str_bytes(b), (size_t)lb);
  }
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

MnWord mn_str_slice(MnWord s, MnWord start_t, MnWord end_t) {
  int64_t start = mn_word_to_int(start_t);
  int64_t end = mn_word_to_int(end_t);
  int64_t n = str_len(s);
  if (start < 0) {
    start = 0;
  }
  if (end > n) {
    end = n;
  }
  if (start > end) {
    start = end;
  }
  int64_t len = end - start;
  int64_t total = HDR + 8 + len;
  MnWord *obj = (MnWord *)mn_alloc(total, &shape_str);
  obj[1] = (MnWord)len;
  if (len > 0) {
    memcpy((uint8_t *)(obj + 2), str_bytes(s) + start, (size_t)len);
  }
  return (MnWord)obj;
}

void mn_print_str(MnWord s) {
  int64_t n = str_len(s);
  if (n > 0) {
    mn_write_stdout(str_bytes(s), (size_t)n);
  }
}

MnWord mn_ref_new(MnWord v) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_ref);
  obj[1] = v;
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
  ((MnWord *)(uintptr_t)r)[1] = v;
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
  MnWord *obj = (MnWord *)(uintptr_t)sb;
  int64_t len = (int64_t)obj[2];
  int64_t total = HDR + 8 + len;
  MnWord *str = (MnWord *)mn_alloc(total, &shape_str);
  str[1] = (MnWord)len;
  if (len > 0) {
    memcpy((uint8_t *)(str + 2), (uint8_t *)(uintptr_t)obj[1], (size_t)len);
  }
  obj[2] = 0;
  return (MnWord)str;
}

#include <stdio.h>

MnWord mn_show(MnWord v) {
  char buf[64];
  int n;
  if (mn_is_immediate(v)) {
    /* Int / Bool / Unit share odd immediates; print as Int decimal. */
    n = snprintf(buf, sizeof(buf), "%lld", (long long)mn_word_to_int(v));
  } else {
    n = snprintf(buf, sizeof(buf), "#<obj>");
  }
  if (n < 0) {
    mn_panic("mn_show: snprintf failed");
  }
  return mn_str_new((int64_t)(uintptr_t)buf, (int64_t)n);
}
