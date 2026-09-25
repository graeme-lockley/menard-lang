import type { Value } from "../interp/value.ts";

/** Persistent map with value semantics — structural copy on write (simple impl). */
export type MenardMap = {
  kind: "map";
  /** insertion-stable store; iteration uses sorted keys via compare */
  entries: Map<string, { key: Value; val: Value }>;
};

function keyId(k: Value): string {
  switch (k.tag) {
    case "int":
      return `i:${k.value}`;
    case "bool":
      return `b:${k.value}`;
    case "str":
      return `s:${Buffer.from(k.bytes).toString("hex")}`;
    case "sym":
      return `y:${Buffer.from(k.name).toString("hex")}`;
    case "float":
      return `f:${Object.is(k.value, -0) ? "-0" : String(k.value)}`;
    case "unit":
      return "u";
    case "char":
      return `c:${k.value}`;
    default:
      throw new Error("map key must be orderable primitive");
  }
}

export function mapNew(): MenardMap {
  return { kind: "map", entries: new Map() };
}

export function mapSet(m: MenardMap, k: Value, v: Value): MenardMap {
  const next = new Map(m.entries);
  next.set(keyId(k), { key: k, val: v });
  return { kind: "map", entries: next };
}

export function mapGet(m: MenardMap, k: Value): Value | undefined {
  return m.entries.get(keyId(k))?.val;
}

export function mapHas(m: MenardMap, k: Value): boolean {
  return m.entries.has(keyId(k));
}

export function mapSize(m: MenardMap): bigint {
  return BigInt(m.entries.size);
}

export function mapKeys(m: MenardMap): Value[] {
  const items = [...m.entries.values()].map((e) => e.key);
  items.sort((a, b) => compareValues(a, b));
  return items;
}

export function mapEntries(m: MenardMap): { keys: Value[]; vals: Value[] } {
  const items = [...m.entries.values()];
  items.sort((a, b) => compareValues(a.key, b.key));
  return {
    keys: items.map((e) => e.key),
    vals: items.map((e) => e.val),
  };
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
      const bb = b.tag === "str" ? (b as typeof a & { tag: "str" }).bytes : (b as { tag: "sym"; name: Uint8Array }).name;
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
