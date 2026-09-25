import type { Value } from "./value.ts";

export function showValue(v: Value): string {
  switch (v.tag) {
    case "int":
      return v.value.toString();
    case "float":
      if (Object.is(v.value, -0)) return "-0.0";
      if (Object.is(v.value, 0)) return "0.0";
      if (Number.isInteger(v.value)) return `${v.value}.0`;
      return String(v.value);
    case "bool":
      return v.value ? "true" : "false";
    case "unit":
      return "()";
    case "char":
      return String(v.value);
    case "str": {
      let out = '"';
      for (let i = 0; i < v.bytes.length; i++) {
        const b = v.bytes[i]!;
        if (b === 0x5c || b === 0x22) out += "\\";
        out += String.fromCharCode(b);
      }
      return out + '"';
    }
    case "sym":
      return "'" + new TextDecoder().decode(v.name);
    case "list":
      return `[${v.elems.map(showValue).join(" ")}]`;
    case "variant":
      return v.payloads.length === 0
        ? `(${v.ctor})`
        : `(${v.ctor} ${v.payloads.map(showValue).join(" ")})`;
    case "record":
      return `(${v.name} ${v.fields.map(showValue).join(" ")})`;
    case "map": {
      const items = [...v.map.entries.values()];
      items.sort((a, b) => compareValue(a.key, b.key));
      const parts: string[] = [];
      for (const e of items) {
        parts.push(showValue(e.key), showValue(e.val));
      }
      return `{${parts.join(" ")}}`;
    }
    case "ref":
    case "fn":
    case "builtin":
    case "sb":
      throw new Error(`type ${v.tag} is not showable`);
  }
}

export function equalValue(a: Value, b: Value): boolean {
  if (a.tag !== b.tag) return false;
  switch (a.tag) {
    case "int":
      return a.value === (b as typeof a).value;
    case "float":
      return Object.is(a.value, (b as typeof a).value);
    case "bool":
      return a.value === (b as typeof a).value;
    case "unit":
      return true;
    case "char":
      return a.value === (b as typeof a).value;
    case "str": {
      const bb = (b as typeof a).bytes;
      return a.bytes.length === bb.length && a.bytes.every((x, i) => x === bb[i]);
    }
    case "sym": {
      const bb = (b as typeof a).name;
      return a.name.length === bb.length && a.name.every((x, i) => x === bb[i]);
    }
    case "list": {
      const bb = (b as typeof a).elems;
      return a.elems.length === bb.length && a.elems.every((x, i) => equalValue(x, bb[i]!));
    }
    case "variant": {
      const bb = b as typeof a;
      return (
        a.ctor === bb.ctor &&
        a.payloads.length === bb.payloads.length &&
        a.payloads.every((x, i) => equalValue(x, bb.payloads[i]!))
      );
    }
    case "record": {
      const bb = b as typeof a;
      return (
        a.name === bb.name &&
        a.fields.length === bb.fields.length &&
        a.fields.every((x, i) => equalValue(x, bb.fields[i]!))
      );
    }
    case "ref":
      return a.cell === (b as typeof a).cell;
    case "fn":
    case "builtin":
      return a === b;
    case "sb":
      return a.sb === (b as typeof a).sb;
    case "map": {
      const bb = (b as typeof a).map;
      if (a.map.entries.size !== bb.entries.size) return false;
      for (const [k, e] of a.map.entries) {
        const o = bb.entries.get(k);
        if (!o || !equalValue(e.val, o.val)) return false;
      }
      return true;
    }
  }
}

export function compareValue(a: Value, b: Value): number {
  if (a.tag !== b.tag) return a.tag < b.tag ? -1 : 1;
  switch (a.tag) {
    case "int": {
      const x = a.value;
      const y = (b as typeof a).value;
      return x < y ? -1 : x > y ? 1 : 0;
    }
    case "float": {
      const x = a.value;
      const y = (b as typeof a).value;
      if (Object.is(x, y)) return 0;
      return x < y ? -1 : 1;
    }
    case "bool":
      return Number(a.value) - Number((b as typeof a).value);
    case "unit":
      return 0;
    case "char":
      return a.value - (b as typeof a).value;
    case "str":
    case "sym": {
      const aa = a.tag === "str" ? a.bytes : a.name;
      const bb =
        b.tag === "str"
          ? (b as { bytes: Uint8Array }).bytes
          : (b as { name: Uint8Array }).name;
      const n = Math.min(aa.length, bb.length);
      for (let i = 0; i < n; i++) {
        if (aa[i]! !== bb[i]!) return aa[i]! - bb[i]!;
      }
      return aa.length - bb.length;
    }
    case "list": {
      const bb = (b as typeof a).elems;
      const n = Math.min(a.elems.length, bb.length);
      for (let i = 0; i < n; i++) {
        const c = compareValue(a.elems[i]!, bb[i]!);
        if (c !== 0) return c;
      }
      return a.elems.length - bb.length;
    }
    case "variant": {
      const bb = b as typeof a;
      if (a.ctor !== bb.ctor) return a.ctor < bb.ctor ? -1 : 1;
      const n = Math.min(a.payloads.length, bb.payloads.length);
      for (let i = 0; i < n; i++) {
        const c = compareValue(a.payloads[i]!, bb.payloads[i]!);
        if (c !== 0) return c;
      }
      return a.payloads.length - bb.payloads.length;
    }
    case "record": {
      const bb = b as typeof a;
      if (a.name !== bb.name) return a.name < bb.name ? -1 : 1;
      const n = Math.min(a.fields.length, bb.fields.length);
      for (let i = 0; i < n; i++) {
        const c = compareValue(a.fields[i]!, bb.fields[i]!);
        if (c !== 0) return c;
      }
      return a.fields.length - bb.fields.length;
    }
    case "map": {
      const ae = [...a.map.entries.values()].sort((x, y) =>
        compareValue(x.key, y.key),
      );
      const be = [...(b as typeof a).map.entries.values()].sort((x, y) =>
        compareValue(x.key, y.key),
      );
      const n = Math.min(ae.length, be.length);
      for (let i = 0; i < n; i++) {
        const ck = compareValue(ae[i]!.key, be[i]!.key);
        if (ck !== 0) return ck;
        const cv = compareValue(ae[i]!.val, be[i]!.val);
        if (cv !== 0) return cv;
      }
      return ae.length - be.length;
    }
    default:
      return 0;
  }
}

/** Loose debug printer — depth-capped; may show Ref/Fn/StringBuffer. */
export function dumpValue(v: Value, depth = 0): string {
  if (depth > 8) return "...";
  switch (v.tag) {
    case "ref":
      return `(Ref ${dumpValue(v.cell.value, depth + 1)})`;
    case "fn":
      return `(Fn ${v.params.join(" ")})`;
    case "builtin":
      return `(Builtin ${v.name})`;
    case "sb":
      return `(StringBuffer len=${v.sb.length})`;
    case "list":
      return `[${v.elems.map((e) => dumpValue(e, depth + 1)).join(" ")}]`;
    case "variant":
      return `(${v.ctor}${v.payloads.map((p) => " " + dumpValue(p, depth + 1)).join("")})`;
    case "record":
      return `(${v.name}${v.fields.map((f) => " " + dumpValue(f, depth + 1)).join("")})`;
    case "map":
      return `{map size=${v.map.entries.size}}`;
    default:
      try {
        return showValue(v);
      } catch {
        return `<${v.tag}>`;
      }
  }
}
