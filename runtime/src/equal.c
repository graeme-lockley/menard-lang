/*
 * Value-directed `=` and `compare` (Phase 3).
 *
 * The lowerer is untyped, so every `(= a b)` and `(compare a b)` lands
 * here. Dispatch matches host/src/interp/derive.ts for the values the
 * compiler actually compares: immediates as integers, Str by bytes,
 * lists and other ordinary objects by shape tag then slots, Map by
 * inorder entries. Ref, StringBuffer, and closures stay identity.
 */
#include "menard.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define TAG_STR 10
#define TAG_REF 11
#define TAG_SB 12
#define TAG_MAP 20
#define TAG_CLOSURE 100
#define TAG_BARE 102

static int64_t shape_tag(MnWord obj) {
  return (int64_t)mn_obj_shape((void *)(uintptr_t)obj)->tag;
}

static int64_t slot_count(MnWord obj) {
  int32_t nbytes = mn_obj_shape((void *)(uintptr_t)obj)->nbytes;
  int64_t n = ((int64_t)nbytes - (int64_t)sizeof(void *)) / 8;
  return n < 0 ? 0 : n;
}

static MnWord slot_at(MnWord obj, int64_t i) {
  return ((MnWord *)(uintptr_t)obj)[1 + i];
}

static int64_t str_len(MnWord s) { return (int64_t)((MnWord *)(uintptr_t)s)[1]; }

static const uint8_t *str_bytes(MnWord s) {
  return (const uint8_t *)(((MnWord *)(uintptr_t)s) + 2);
}

/* -1 / 0 / 1, same as memcmp then length. */
static int cmp_str(MnWord a, MnWord b) {
  int64_t la = str_len(a);
  int64_t lb = str_len(b);
  int64_t n = la < lb ? la : lb;
  int c = 0;
  if (n > 0) {
    c = memcmp(str_bytes(a), str_bytes(b), (size_t)n);
  }
  if (c < 0) {
    return -1;
  }
  if (c > 0) {
    return 1;
  }
  if (la < lb) {
    return -1;
  }
  if (la > lb) {
    return 1;
  }
  return 0;
}

/* Map node: shape | key | val | left | right | height | size. Matches map.c. */
static MnWord node_key(MnWord n) { return ((MnWord *)(uintptr_t)n)[1]; }
static MnWord node_val(MnWord n) { return ((MnWord *)(uintptr_t)n)[2]; }
static MnWord node_left(MnWord n) { return ((MnWord *)(uintptr_t)n)[3]; }
static MnWord node_right(MnWord n) { return ((MnWord *)(uintptr_t)n)[4]; }
static int64_t node_size(MnWord n) {
  if (n == MN_EMPTY) {
    return 0;
  }
  /* Height and size are tagged immediates so the collector skips them. */
  return mn_word_to_int(((MnWord *)(uintptr_t)n)[6]);
}

typedef struct {
  MnWord key;
  MnWord val;
} MapPair;

static void map_collect(MnWord n, MapPair *out, int64_t *i) {
  if (n == MN_EMPTY) {
    return;
  }
  map_collect(node_left(n), out, i);
  out[*i].key = node_key(n);
  out[*i].val = node_val(n);
  (*i)++;
  map_collect(node_right(n), out, i);
}

static int ident_tag(int64_t tag) {
  return tag == TAG_REF || tag == TAG_SB || tag == TAG_CLOSURE || tag == TAG_BARE;
}

static int mn_equal_raw(MnWord a, MnWord b);

/* Entry-wise, inorder. Tree shape does not matter. */
static int map_equal(MnWord a, MnWord b) {
  MnWord ra = slot_at(a, 0);
  MnWord rb = slot_at(b, 0);
  int64_t na = node_size(ra);
  int64_t nb = node_size(rb);
  if (na != nb) {
    return 0;
  }
  if (na == 0) {
    return 1;
  }
  MapPair *pa = (MapPair *)malloc((size_t)na * sizeof(MapPair));
  MapPair *pb = (MapPair *)malloc((size_t)nb * sizeof(MapPair));
  if (pa == NULL || pb == NULL) {
    free(pa);
    free(pb);
    mn_panic("mn_equal: map malloc failed");
  }
  int64_t ia = 0;
  int64_t ib = 0;
  map_collect(ra, pa, &ia);
  map_collect(rb, pb, &ib);
  int ok = 1;
  for (int64_t i = 0; i < na; i++) {
    if (!mn_equal_raw(pa[i].key, pb[i].key) || !mn_equal_raw(pa[i].val, pb[i].val)) {
      ok = 0;
      break;
    }
  }
  free(pa);
  free(pb);
  return ok;
}

static int mn_equal_raw(MnWord a, MnWord b) {
  if (a == b) {
    return 1;
  }
  if (mn_is_immediate(a) || mn_is_immediate(b)) {
    if (mn_is_immediate(a) && mn_is_immediate(b)) {
      return mn_word_to_int(a) == mn_word_to_int(b);
    }
    return 0;
  }
  int64_t ta = shape_tag(a);
  int64_t tb = shape_tag(b);
  if (ta != tb) {
    return 0;
  }
  if (ta == TAG_STR) {
    return cmp_str(a, b) == 0;
  }
  if (ident_tag(ta)) {
    return 0;
  }
  if (ta == TAG_MAP) {
    return map_equal(a, b);
  }
  int64_t n = slot_count(a);
  int64_t nb = slot_count(b);
  if (n != nb) {
    return 0;
  }
  for (int64_t i = 0; i < n; i++) {
    if (!mn_equal_raw(slot_at(a, i), slot_at(b, i))) {
      return 0;
    }
  }
  return 1;
}

MnWord mn_equal(MnWord a, MnWord b) {
  return mn_equal_raw(a, b) ? MN_TRUE : MN_FALSE;
}

static int cmp_raw(MnWord a, MnWord b) {
  if (a == b) {
    return 0;
  }
  if (mn_is_immediate(a) && mn_is_immediate(b)) {
    int64_t ia = mn_word_to_int(a);
    int64_t ib = mn_word_to_int(b);
    if (ia < ib) {
      return -1;
    }
    if (ia > ib) {
      return 1;
    }
    return 0;
  }
  if (mn_is_immediate(a)) {
    return -1;
  }
  if (mn_is_immediate(b)) {
    return 1;
  }
  int64_t ta = shape_tag(a);
  int64_t tb = shape_tag(b);
  if (ta != tb) {
    return ta < tb ? -1 : 1;
  }
  if (ta == TAG_STR) {
    return cmp_str(a, b);
  }
  int64_t n = slot_count(a);
  int64_t nb = slot_count(b);
  int64_t m = n < nb ? n : nb;
  for (int64_t i = 0; i < m; i++) {
    int c = cmp_raw(slot_at(a, i), slot_at(b, i));
    if (c != 0) {
      return c;
    }
  }
  if (n < nb) {
    return -1;
  }
  if (n > nb) {
    return 1;
  }
  return 0;
}

MnWord mn_compare(MnWord a, MnWord b) { return mn_int_to_word(cmp_raw(a, b)); }
