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
  return mn_word_to_int((MnWord)node_view(n)->height);
}

static int64_t node_size(MnWord n) {
  if (n == MN_EMPTY) {
    return 0;
  }
  return mn_word_to_int((MnWord)node_view(n)->size);
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
  MnWord ks, vs, ls, rs;
  mn_root_push(&ks);
  ks = key;
  mn_root_push(&vs);
  vs = val;
  mn_root_push(&ls);
  ls = left;
  mn_root_push(&rs);
  rs = right;
  MnWord *obj = (MnWord *)mn_alloc(HDR + 48, &shape_node56);
  NodeView *nv = (NodeView *)(obj + 1);
  nv->key = ks;
  nv->val = vs;
  nv->left = ls;
  nv->right = rs;
  int64_t hl = node_height(ls);
  int64_t hr = node_height(rs);
  nv->height = (int64_t)mn_int_to_word(1 + (hl > hr ? hl : hr));
  nv->size = (int64_t)mn_int_to_word(1 + node_size(ls) + node_size(rs));
  mn_root_pop();
  mn_root_pop();
  mn_root_pop();
  mn_root_pop();
  return (MnWord)obj;
}

static MnWord rotate_left(MnWord n) {
  MnWord ns, rs;
  mn_root_push(&ns);
  ns = n;
  mn_root_push(&rs);
  rs = node_view(ns)->right;
  MnWord inner = mk_node(node_view(ns)->key, node_view(ns)->val, node_view(ns)->left, node_view(rs)->left);
  MnWord result = mk_node(node_view(rs)->key, node_view(rs)->val, inner, node_view(rs)->right);
  mn_root_pop();
  mn_root_pop();
  return result;
}

static MnWord rotate_right(MnWord n) {
  MnWord ns, ls;
  mn_root_push(&ns);
  ns = n;
  mn_root_push(&ls);
  ls = node_view(ns)->left;
  MnWord inner = mk_node(node_view(ns)->key, node_view(ns)->val, node_view(ls)->right, node_view(ns)->right);
  MnWord result = mk_node(node_view(ls)->key, node_view(ls)->val, node_view(ls)->left, inner);
  mn_root_pop();
  mn_root_pop();
  return result;
}

static MnWord balance(MnWord n) {
  MnWord ns;
  mn_root_push(&ns);
  ns = n;
  int64_t bf = node_height(node_view(ns)->left) - node_height(node_view(ns)->right);
  MnWord result;
  if (bf > 1) {
    MnWord left = node_view(ns)->left;
    if (node_height(node_view(left)->right) > node_height(node_view(left)->left)) {
      MnWord rotated = rotate_left(left);
      MnWord key = node_view(ns)->key;
      MnWord val = node_view(ns)->val;
      MnWord right = node_view(ns)->right;
      result = rotate_right(mk_node(key, val, rotated, right));
    } else {
      result = rotate_right(ns);
    }
  } else if (bf < -1) {
    MnWord right = node_view(ns)->right;
    if (node_height(node_view(right)->left) > node_height(node_view(right)->right)) {
      MnWord rotated = rotate_right(right);
      MnWord key = node_view(ns)->key;
      MnWord val = node_view(ns)->val;
      MnWord left = node_view(ns)->left;
      result = rotate_left(mk_node(key, val, left, rotated));
    } else {
      result = rotate_left(ns);
    }
  } else {
    result = ns;
  }
  mn_root_pop();
  return result;
}

static MnWord insert(MnWord node, MnWord k, MnWord v) {
  MnWord ns, ks, vs;
  mn_root_push(&ns);
  ns = node;
  mn_root_push(&ks);
  ks = k;
  mn_root_push(&vs);
  vs = v;
  MnWord result;
  if (ns == MN_EMPTY) {
    result = mk_node(ks, vs, MN_EMPTY, MN_EMPTY);
  } else {
    int c = key_cmp(ks, node_view(ns)->key);
    if (c == 0) {
      result = mk_node(ks, vs, node_view(ns)->left, node_view(ns)->right);
    } else if (c < 0) {
      MnWord left = insert(node_view(ns)->left, ks, vs);
      result = balance(mk_node(node_view(ns)->key, node_view(ns)->val, left, node_view(ns)->right));
    } else {
      MnWord right = insert(node_view(ns)->right, ks, vs);
      result = balance(mk_node(node_view(ns)->key, node_view(ns)->val, node_view(ns)->left, right));
    }
  }
  mn_root_pop();
  mn_root_pop();
  mn_root_pop();
  return result;
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
  MnWord ms, ks, vs, held;
  mn_root_push(&ms);
  ms = m;
  mn_root_push(&ks);
  ks = k;
  mn_root_push(&vs);
  vs = v;
  MnWord root = ((MnWord *)(uintptr_t)ms)[1];
  mn_root_push(&held);
  held = insert(root, ks, vs);
  MnWord *obj = (MnWord *)mn_alloc(HDR + 8, &shape_map);
  mn_gc_store(obj, &obj[1], held);
  mn_root_pop();
  mn_root_pop();
  mn_root_pop();
  mn_root_pop();
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

static void fill_keys(MnWord n, MnWord *out, int *i) {
  if (n == MN_EMPTY) {
    return;
  }
  NodeView *nv = node_view(n);
  fill_keys(nv->left, out, i);
  out[(*i)++] = nv->key;
  fill_keys(nv->right, out, i);
}

MnWord mn_map_keys(MnWord m) {
  if (mn_is_immediate(m)) {
    mn_panic("mn_map_keys: expected Map");
  }
  MnWord root = ((MnWord *)(uintptr_t)m)[1];
  int64_t n = node_size(root);
  if (n == 0) {
    return mn_nil();
  }
  MnWord *buf = (MnWord *)malloc((size_t)n * sizeof(MnWord));
  if (!buf) {
    mn_panic("mn_map_keys: out of memory");
  }
  int filled = 0;
  fill_keys(root, buf, &filled);
  MnWord *rooted = (MnWord *)malloc((size_t)n * sizeof(MnWord));
  if (!rooted) {
    free(buf);
    mn_panic("mn_map_keys: out of memory");
  }
  for (int64_t i = 0; i < n; i++) {
    mn_root_push(&rooted[i]);
    rooted[i] = buf[i];
  }
  free(buf);
  MnWord acc;
  mn_root_push(&acc);
  acc = mn_nil();
  for (int64_t i = n - 1; i >= 0; i--) {
    acc = mn_cons(rooted[i], acc);
  }
  MnWord out = acc;
  mn_root_pop();
  for (int64_t i = n - 1; i >= 0; i--) {
    mn_root_pop();
  }
  free(rooted);
  return out;
}
