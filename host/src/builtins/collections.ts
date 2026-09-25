import type { Value } from "../interp/value.ts";

/**
 * Persistent ordered map (AVL tree) with value semantics.
 * Updates are O(log n) with structural sharing; in-order walk yields
 * canonical key order (§2.11.O) without a separate sort.
 */
export type MenardMap = {
  kind: "map";
  root: MapNode | null;
};

type MapNode = {
  key: Value;
  val: Value;
  left: MapNode | null;
  right: MapNode | null;
  height: number;
  size: number;
};

export function mapNew(): MenardMap {
  return { kind: "map", root: null };
}

export function mapSet(m: MenardMap, k: Value, v: Value): MenardMap {
  return { kind: "map", root: insert(m.root, k, v) };
}

export function mapGet(m: MenardMap, k: Value): Value | undefined {
  let n = m.root;
  while (n) {
    const c = compareValues(k, n.key);
    if (c === 0) return n.val;
    n = c < 0 ? n.left : n.right;
  }
  return undefined;
}

export function mapHas(m: MenardMap, k: Value): boolean {
  return mapGet(m, k) !== undefined;
}

export function mapSize(m: MenardMap): bigint {
  return BigInt(m.root?.size ?? 0);
}

export function mapKeys(m: MenardMap): Value[] {
  const out: Value[] = [];
  inorder(m.root, (n) => out.push(n.key));
  return out;
}

export function mapEntries(m: MenardMap): { keys: Value[]; vals: Value[] } {
  const keys: Value[] = [];
  const vals: Value[] = [];
  inorder(m.root, (n) => {
    keys.push(n.key);
    vals.push(n.val);
  });
  return { keys, vals };
}

function height(n: MapNode | null): number {
  return n?.height ?? 0;
}

function sizeOf(n: MapNode | null): number {
  return n?.size ?? 0;
}

function mk(
  key: Value,
  val: Value,
  left: MapNode | null,
  right: MapNode | null,
): MapNode {
  return {
    key,
    val,
    left,
    right,
    height: 1 + Math.max(height(left), height(right)),
    size: 1 + sizeOf(left) + sizeOf(right),
  };
}

function rotateLeft(n: MapNode): MapNode {
  const r = n.right!;
  return mk(r.key, r.val, mk(n.key, n.val, n.left, r.left), r.right);
}

function rotateRight(n: MapNode): MapNode {
  const l = n.left!;
  return mk(l.key, l.val, l.left, mk(n.key, n.val, l.right, n.right));
}

function balance(n: MapNode): MapNode {
  const bf = height(n.left) - height(n.right);
  if (bf > 1) {
    const l = n.left!;
    if (height(l.right) > height(l.left)) {
      return rotateRight(mk(n.key, n.val, rotateLeft(l), n.right));
    }
    return rotateRight(n);
  }
  if (bf < -1) {
    const r = n.right!;
    if (height(r.left) > height(r.right)) {
      return rotateLeft(mk(n.key, n.val, n.left, rotateRight(r)));
    }
    return rotateLeft(n);
  }
  return n;
}

function insert(node: MapNode | null, k: Value, v: Value): MapNode {
  if (!node) return mk(k, v, null, null);
  const c = compareValues(k, node.key);
  if (c === 0) return mk(k, v, node.left, node.right);
  if (c < 0) return balance(mk(node.key, node.val, insert(node.left, k, v), node.right));
  return balance(mk(node.key, node.val, node.left, insert(node.right, k, v)));
}

function inorder(node: MapNode | null, visit: (n: MapNode) => void): void {
  if (!node) return;
  inorder(node.left, visit);
  visit(node);
  inorder(node.right, visit);
}

function compareValues(a: Value, b: Value): number {
  if (a.tag !== b.tag) return a.tag < b.tag ? -1 : 1;
  switch (a.tag) {
    case "int":
      return a.value < (b as typeof a).value ? -1 : a.value > (b as typeof a).value ? 1 : 0;
    case "float": {
      const x = a.value;
      const y = (b as typeof a).value;
      if (Object.is(x, y)) return 0;
      return x < y ? -1 : 1;
    }
    case "bool":
      return Number(a.value) - Number((b as typeof a).value);
    case "str":
    case "sym": {
      const aa = a.tag === "str" ? a.bytes : a.name;
      const bb =
        b.tag === "str"
          ? (b as typeof a & { tag: "str" }).bytes
          : (b as { tag: "sym"; name: Uint8Array }).name;
      const n = Math.min(aa.length, bb.length);
      for (let i = 0; i < n; i++) {
        if (aa[i]! !== bb[i]!) return aa[i]! - bb[i]!;
      }
      return aa.length - bb.length;
    }
    case "char":
      return a.value - (b as typeof a).value;
    case "unit":
      return 0;
    default:
      return 0;
  }
}

export type StringBuffer = {
  kind: "sb";
  /** mutable backing; shared with Str until append after to-str */
  bytes: Uint8Array;
  length: number;
  shared: boolean; // true after sb-to-str until next mutating op
};

export function sbNew(): StringBuffer {
  return { kind: "sb", bytes: new Uint8Array(16), length: 0, shared: false };
}

function sbEnsureUnique(sb: StringBuffer): void {
  if (sb.shared) {
    sb.bytes = sb.bytes.slice(0, sb.length);
    sb.shared = false;
  }
}

function sbGrow(sb: StringBuffer, need: number): void {
  if (need <= sb.bytes.length) return;
  let cap = sb.bytes.length || 16;
  while (cap < need) cap *= 2;
  const n = new Uint8Array(cap);
  n.set(sb.bytes.subarray(0, sb.length));
  sb.bytes = n;
}

export function sbAppend(sb: StringBuffer, s: Uint8Array): void {
  sbEnsureUnique(sb);
  sbGrow(sb, sb.length + s.length);
  sb.bytes.set(s, sb.length);
  sb.length += s.length;
}

export function sbAppendByte(sb: StringBuffer, b: number): void {
  sbEnsureUnique(sb);
  sbGrow(sb, sb.length + 1);
  sb.bytes[sb.length++] = b & 0xff;
}

export function sbClear(sb: StringBuffer): void {
  sbEnsureUnique(sb);
  sb.length = 0;
}

export function sbToStr(sb: StringBuffer): Uint8Array {
  sb.shared = true;
  return sb.bytes.subarray(0, sb.length);
}

export function sbTakeStr(sb: StringBuffer): Uint8Array {
  const out = sb.bytes.subarray(0, sb.length);
  sb.bytes = new Uint8Array(16);
  sb.length = 0;
  sb.shared = false;
  return out.slice(); // owned by Str
}
