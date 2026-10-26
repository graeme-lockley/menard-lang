/**
 * Shared native runtime link inputs (Build F: net.c + tls.c + OpenSSL).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const RUNTIME_RELS = [
  "runtime/src/alloc.c",
  "runtime/src/gc.c",
  "runtime/src/panic.c",
  "runtime/src/print.c",
  "runtime/src/shadow.c",
  "runtime/src/variants.c",
  "runtime/src/str.c",
  "runtime/src/float_text.c",
  "runtime/third_party/ryu/d2s.c",
  "runtime/src/map.c",
  "runtime/src/closure.c",
  "runtime/src/io.c",
  "runtime/src/equal.c",
  "runtime/src/task.c",
  "runtime/src/net.c",
  "runtime/src/tls.c",
] as const;

export function runtimeLibSrcs(root: string): string[] {
  return RUNTIME_RELS.map((rel) => join(root, rel));
}

export function runtimeInclude(root: string): string {
  return join(root, "runtime/include");
}

/** Parent of `ryu/` so `#include "ryu/ryu.h"` resolves. */
export function runtimeThirdPartyInclude(root: string): string {
  return join(root, "runtime/third_party");
}

/** Compile-time `-I` for OpenSSL headers. */
export function opensslCflags(): string[] {
  if (existsSync("/opt/homebrew/opt/openssl@3/include")) {
    return ["-I/opt/homebrew/opt/openssl@3/include"];
  }
  if (existsSync("/usr/local/opt/openssl@3/include")) {
    return ["-I/usr/local/opt/openssl@3/include"];
  }
  return [];
}

/** Link-time OpenSSL libs. */
export function opensslLibs(): string[] {
  if (existsSync("/opt/homebrew/opt/openssl@3/lib")) {
    return ["-L/opt/homebrew/opt/openssl@3/lib", "-lssl", "-lcrypto"];
  }
  if (existsSync("/usr/local/opt/openssl@3/lib")) {
    return ["-L/usr/local/opt/openssl@3/lib", "-lssl", "-lcrypto"];
  }
  return ["-lssl", "-lcrypto"];
}
