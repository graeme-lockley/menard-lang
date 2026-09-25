import type { Ast } from "./ast.ts";
import { nameEquals } from "./ast.ts";
import type { Span } from "./span.ts";

export type CasingError = {
  span: Span;
  message: string;
};

export type CasingOk = { ok: true };
export type CasingErr = { ok: false; error: CasingError };
export type CasingResult = CasingOk | CasingErr;

function isUpperInitial(name: Uint8Array): boolean {
  const b = name[0];
  return b !== undefined && b >= 0x41 && b <= 0x5a;
}

function isLowerInitial(name: Uint8Array): boolean {
  const b = name[0];
  return b !== undefined && b >= 0x61 && b <= 0x7a;
}

function expectLower(sym: Ast, role: string): CasingResult {
  if (sym.tag !== "sym") {
    return {
      ok: false,
      error: {
        span: sym.span,
        message: `expected ${role} to be a symbol`,
      },
    };
  }
  if (!isLowerInitial(sym.name)) {
    return {
      ok: false,
      error: {
        span: sym.span,
        message: `${role} must begin with a lowercase letter`,
      },
    };
  }
  return { ok: true };
}

function expectUpper(sym: Ast, role: string): CasingResult {
  if (sym.tag !== "sym") {
    return {
      ok: false,
      error: {
        span: sym.span,
        message: `expected ${role} to be a symbol`,
      },
    };
  }
  if (!isUpperInitial(sym.name)) {
    return {
      ok: false,
      error: {
        span: sym.span,
        message: `${role} must begin with an uppercase letter`,
      },
    };
  }
  return { ok: true };
}

function checkTypeParams(node: Ast): CasingResult {
  if (node.tag !== "list" || node.kind !== "bracket") {
    return {
      ok: false,
      error: {
        span: node.span,
        message: "type parameters must be a bracket list",
      },
    };
  }
  for (const p of node.elems) {
    const r = expectLower(p, "type parameter");
    if (!r.ok) return r;
  }
  return { ok: true };
}

/** Walk type expressions in declaration skeletons: Upper constructors, lower vars. */
function checkTypeExpr(node: Ast): CasingResult {
  switch (node.tag) {
    case "sym":
      // type variable (lower) or nullary type ctor (Upper)
      if (isLowerInitial(node.name) || isUpperInitial(node.name)) {
        return { ok: true };
      }
      return {
        ok: false,
        error: {
          span: node.span,
          message: "type name must begin with a letter",
        },
      };
    case "list": {
      if (node.kind === "bracket") {
        // shouldn't appear as a bare type expr except params — treat elems as types
        for (const e of node.elems) {
          const r = checkTypeExpr(e);
          if (!r.ok) return r;
        }
        return { ok: true };
      }
      if (node.elems.length === 0) {
        // Unit: ()
        return { ok: true };
      }
      const head = node.elems[0]!;
      if (head.tag === "sym") {
        // (Name T …) application — Name must be Upper
        const r = expectUpper(head, "type constructor");
        if (!r.ok) return r;
        for (let i = 1; i < node.elems.length; i++) {
          const t = checkTypeExpr(node.elems[i]!);
          if (!t.ok) return t;
        }
        return { ok: true };
      }
      // nested / other — recurse
      for (const e of node.elems) {
        const r = checkTypeExpr(e);
        if (!r.ok) return r;
      }
      return { ok: true };
    }
    default:
      return {
        ok: false,
        error: {
          span: node.span,
          message: "invalid type expression",
        },
      };
  }
}

function checkField(node: Ast): CasingResult {
  // (fst: a) — single-element or field:type pair as list
  if (node.tag !== "list" || node.kind !== "paren" || node.elems.length < 1) {
    return {
      ok: false,
      error: {
        span: node.span,
        message: "expected field form (name: Type)",
      },
    };
  }
  const name = node.elems[0]!;
  if (name.tag !== "sym") {
    return {
      ok: false,
      error: { span: name.span, message: "expected field name" },
    };
  }
  // field name may be `fst:` with trailing colon
  const raw = name.name;
  let fieldBytes = raw;
  if (raw.length > 0 && raw[raw.length - 1] === 0x3a) {
    fieldBytes = raw.subarray(0, raw.length - 1);
  }
  if (fieldBytes.length === 0 || !isLowerInitial(fieldBytes)) {
    return {
      ok: false,
      error: {
        span: name.span,
        message: "field name must begin with a lowercase letter",
      },
    };
  }
  for (let i = 1; i < node.elems.length; i++) {
    const r = checkTypeExpr(node.elems[i]!);
    if (!r.ok) return r;
  }
  return { ok: true };
}

function checkVariantCtor(node: Ast): CasingResult {
  if (node.tag !== "list" || node.kind !== "paren" || node.elems.length < 1) {
    return {
      ok: false,
      error: {
        span: node.span,
        message: "expected variant constructor form",
      },
    };
  }
  const r = expectUpper(node.elems[0]!, "variant constructor");
  if (!r.ok) return r;
  for (let i = 1; i < node.elems.length; i++) {
    const t = checkTypeExpr(node.elems[i]!);
    if (!t.ok) return t;
  }
  return { ok: true };
}

function checkDefn(form: Ast & { tag: "list" }): CasingResult {
  // (defn name …) or (defn (name [params]) …)
  if (form.elems.length < 2) {
    return {
      ok: false,
      error: { span: form.span, message: "malformed defn" },
    };
  }
  const namePart = form.elems[1]!;
  if (namePart.tag === "sym") {
    return expectLower(namePart, "function name");
  }
  if (namePart.tag === "list" && namePart.kind === "paren" && namePart.elems.length >= 1) {
    const r = expectLower(namePart.elems[0]!, "function name");
    if (!r.ok) return r;
    if (namePart.elems[1]) {
      const p = checkTypeParams(namePart.elems[1]);
      if (!p.ok) return p;
    }
    return { ok: true };
  }
  return {
    ok: false,
    error: { span: namePart.span, message: "malformed defn name" },
  };
}

function checkDefrec(form: Ast & { tag: "list" }): CasingResult {
  // (defrec Name fields…) or (defrec (Name [a b]) fields…)
  if (form.elems.length < 2) {
    return {
      ok: false,
      error: { span: form.span, message: "malformed defrec" },
    };
  }
  const namePart = form.elems[1]!;
  if (namePart.tag === "sym") {
    const r = expectUpper(namePart, "record type name");
    if (!r.ok) return r;
  } else if (
    namePart.tag === "list" &&
    namePart.kind === "paren" &&
    namePart.elems.length >= 1
  ) {
    const r = expectUpper(namePart.elems[0]!, "record type name");
    if (!r.ok) return r;
    if (namePart.elems[1]) {
      const p = checkTypeParams(namePart.elems[1]);
      if (!p.ok) return p;
    }
  } else {
    return {
      ok: false,
      error: { span: namePart.span, message: "malformed defrec name" },
    };
  }
  for (let i = 2; i < form.elems.length; i++) {
    const f = checkField(form.elems[i]!);
    if (!f.ok) return f;
  }
  return { ok: true };
}

function checkVariant(form: Ast & { tag: "list" }): CasingResult {
  // (variant Name ctors…) or (variant (Name [a]) ctors…)
  if (form.elems.length < 2) {
    return {
      ok: false,
      error: { span: form.span, message: "malformed variant" },
    };
  }
  const namePart = form.elems[1]!;
  if (namePart.tag === "sym") {
    const r = expectUpper(namePart, "variant type name");
    if (!r.ok) return r;
  } else if (
    namePart.tag === "list" &&
    namePart.kind === "paren" &&
    namePart.elems.length >= 1
  ) {
    const r = expectUpper(namePart.elems[0]!, "variant type name");
    if (!r.ok) return r;
    if (namePart.elems[1]) {
      const p = checkTypeParams(namePart.elems[1]);
      if (!p.ok) return p;
    }
  } else {
    return {
      ok: false,
      error: { span: namePart.span, message: "malformed variant name" },
    };
  }
  for (let i = 2; i < form.elems.length; i++) {
    const c = checkVariantCtor(form.elems[i]!);
    if (!c.ok) return c;
  }
  return { ok: true };
}

function checkAlias(form: Ast & { tag: "list" }): CasingResult {
  // (alias Name Type) — Name is a type spelling, Upper
  if (form.elems.length < 3) {
    return {
      ok: false,
      error: { span: form.span, message: "malformed alias" },
    };
  }
  const r = expectUpper(form.elems[1]!, "alias name");
  if (!r.ok) return r;
  return checkTypeExpr(form.elems[2]!);
}

function checkForm(ast: Ast): CasingResult {
  if (ast.tag !== "list" || ast.kind !== "paren" || ast.elems.length === 0) {
    return { ok: true };
  }
  const head = ast.elems[0]!;
  if (head.tag !== "sym") {
    for (const e of ast.elems) {
      const r = checkForm(e);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (nameEquals(head.name, "defn")) return checkDefn(ast);
  if (nameEquals(head.name, "defrec")) return checkDefrec(ast);
  if (nameEquals(head.name, "variant")) return checkVariant(ast);
  if (nameEquals(head.name, "alias")) return checkAlias(ast);
  // unknown head: recurse into children (no false positives on the head)
  for (let i = 1; i < ast.elems.length; i++) {
    const r = checkForm(ast.elems[i]!);
    if (!r.ok) return r;
  }
  return { ok: true };
}

/**
 * Form-aware casing check for known special-form skeletons (§2.1).
 * Unknown heads are skipped (no false positives).
 */
export function checkCasing(ast: Ast): CasingResult {
  return checkForm(ast);
}

/** Check casing on every top-level form. */
export function checkCasingAll(forms: Ast[]): CasingResult {
  for (const f of forms) {
    const r = checkCasing(f);
    if (!r.ok) return r;
  }
  return { ok: true };
}
