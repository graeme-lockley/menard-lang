/*
 * Persistent ordered Map (AVL) — Phase 3 slice F.
 * Int and Str keys only for now (enough for examples + src patterns).
 * Values are opaque MnWords. Structural sharing on set.
 */
#include "menard.h"

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define HDR ((int64_t)sizeof(void *))
#define TAG_MAP 20
#define TAG_MAP_NODE 21

static MnShape shape_map = {.tag = TAG_MAP, .nbytes = 16, .layout = MN_LAYOUT_ORDINARY};

/* Node: shape | key | val | left | right | height | size */
static MnShape shape_node56 = {.tag = TAG_MAP_NODE, .nbytes = 56, .layout = MN_LAYOUT_ORDINARY};

typedef struct {
  MnWord key;
  MnWord val;
  MnWord left;  /* node ptr or 0 */
  MnWord right;
  int64_t height;
  int64_t size;
} NodeView;

static NodeView *node_view(MnWord n) {
  return (NodeView *)(((MnWord *)(uintptr_t)n) + 1);
}

static int64_t node_height(MnWord n) {
  if (n == MN_EMPTY) {
    return 0;
  }
  return node_view(n)->height;
}

static int64_t node_size(MnWord n) {
  if (n == MN_EMPTY) {
    return 0;
  }
  return node_view(n)->size;
}

static int str_cmp_bytes(MnWord a, MnWord b) {
  int64_t la = (int64_t)((MnWord *)(uintptr_t)a)[1];
  int64_t lb = (int64_t)((MnWord *)(uintptr_t)b)[1];
  const uint8_t *pa = (const uint8_t *)(((MnWord *)(uintptr_t)a) + 2);
  const uint8_t *pb = (const uint8_t *)(((MnWord *)(uintptr_t)b) + 2);
  int64_t n = la < lb ? la : lb;
  int c = memcmp(pa, pb, (size_t)n);
  if (c != 0) {
    return c;
  }
  if (la < lb) {
    return -1;
  }
  if (la > lb) {
    return 1;
  }
  return 0;
}

static int key_cmp(MnWord a, MnWord b) {
  /* Both Int immediates, or both Str objects. */
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
  if (!mn_is_immediate(a) && !mn_is_immediate(b)) {
    return str_cmp_bytes(a, b);
  }
  mn_panic("mn_map: mixed or unsupported key types");
  return 0;
}

static MnWord mk_node(MnWord key, MnWord val, MnWord left, MnWord right) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 48, &shape_node56);
  NodeView *nv = (NodeView *)(obj + 1);
  nv->key = key;
  nv->val = val;
  nv->left = left;
  nv->right = right;
  int64_t hl = node_height(left);
  int64_t hr = node_height(right);
  nv->height = 1 + (hl > hr ? hl : hr);
  nv->size = 1 + node_size(left) + node_size(right);
  return (MnWord)obj;
}

static MnWord rotate_left(MnWord n) {
  NodeView *nv = node_view(n);
  MnWord r = nv->right;
  NodeView *rv = node_view(r);
  return mk_node(rv->key, rv->val, mk_node(nv->key, nv->val, nv->left, rv->left), rv->right);
}

static MnWord rotate_right(MnWord n) {
  NodeView *nv = node_view(n);
  MnWord l = nv->left;
  NodeView *lv = node_view(l);
  return mk_node(lv->key, lv->val, lv->left, mk_node(nv->key, nv->val, lv->right, nv->right));
}

static MnWord balance(MnWord n) {
  NodeView *nv = node_view(n);
  int64_t bf = node_height(nv->left) - node_height(nv->right);
  if (bf > 1) {
    NodeView *lv = node_view(nv->left);
    if (node_height(lv->right) > node_height(lv->left)) {
      return rotate_right(mk_node(nv->key, nv->val, rotate_left(nv->left), nv->right));
    }
    return rotate_right(n);
  }
  if (bf < -1) {
    NodeView *rv = node_view(nv->right);
    if (node_height(rv->left) > node_height(rv->right)) {
      return rotate_left(mk_node(nv->key, nv->val, nv->left, rotate_right(nv->right)));
    }
    return rotate_left(n);
  }
  return n;
}

static MnWord insert(MnWord node, MnWord k, MnWord v) {
  if (node == MN_EMPTY) {
    return mk_node(k, v, MN_EMPTY, MN_EMPTY);
  }
  NodeView *nv = node_view(node);
  int c = key_cmp(k, nv->key);
  if (c == 0) {
    return mk_node(k, v, nv->left, nv->right);
  }
  if (c < 0) {
    return balance(mk_node(nv->key, nv->val, insert(nv->left, k, v), nv->right));
  }
  return balance(mk_node(nv->key, nv->val, nv->left, insert(nv->right, k, v)));
}

static MnWord lookup(MnWord node, MnWord k) {
  MnWord n = node;
  while (n != MN_EMPTY) {
    NodeView *nv = node_view(n);
    int c = key_cmp(k, nv->key);
    if (c == 0) {
      return nv->val;
    }
    n = c < 0 ? nv->left : nv->right;
  }
  return MN_EMPTY; /* sentinel — callers use map-has / Maybe via lower */
}

MnWord mn_map_new(void) {
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_map);
  obj[1] = MN_EMPTY;
  return (MnWord)obj;
}

MnWord mn_map_set(MnWord m, MnWord k, MnWord v) {
  if (mn_is_immediate(m)) {
    mn_panic("mn_map_set: expected Map");
  }
  MnWord root = ((MnWord *)(uintptr_t)m)[1];
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_map);
  obj[1] = insert(root, k, v);
  return (MnWord)obj;
}

MnWord mn_map_get(MnWord m, MnWord k) {
  if (mn_is_immediate(m)) {
    mn_panic("mn_map_get: expected Map");
  }
  MnWord root = ((MnWord *)(uintptr_t)m)[1];
  MnWord v = lookup(root, k);
  if (v == MN_EMPTY) {
    /* Return None — use static none from variants via mn_none */
    return mn_none();
  }
  return mn_some(v);
}

MnWord mn_map_has(MnWord m, MnWord k) {
  if (mn_is_immediate(m)) {
    mn_panic("mn_map_has: expected Map");
  }
  MnWord root = ((MnWord *)(uintptr_t)m)[1];
  return lookup(root, k) == MN_EMPTY ? MN_FALSE : MN_TRUE;
}

MnWord mn_map_size(MnWord m) {
  if (mn_is_immediate(m)) {
    mn_panic("mn_map_size: expected Map");
  }
  MnWord root = ((MnWord *)(uintptr_t)m)[1];
  return mn_int_to_word(node_size(root));
}
