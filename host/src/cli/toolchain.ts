import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

function capture(argv: string[], stdin = ""): string {
  if (argv.length === 0) return "";
  const [cmd, ...args] = argv;
  const r = spawnSync(cmd!, args, {
    encoding: "utf-8",
    input: stdin,
    env: process.env,
  });
  if (r.error) return "";
  return r.stdout ?? "";
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return "";
}

/** Extract a dotted version token after the word "version", else the first dotted number. */
export function extractVersion(text: string): string {
  const line = firstNonEmptyLine(text);
  const afterVersion = /\bversion\s+([0-9]+(?:\.[0-9]+)*)/i.exec(line);
  if (afterVersion) return afterVersion[1]!;
  const any = /([0-9]+(?:\.[0-9]+)+)/.exec(line);
  return any ? any[1]! : line || "unknown";
}

export function findOnPath(name: string): string {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

export function chosenCc(): string {
  const flag = process.env.MENARD_CC;
  if (flag && flag.length > 0) return flag;
  const cc = process.env.CC;
  if (cc && cc.length > 0) return cc;
  return "/usr/bin/clang";
}

export function chosenBun(): string {
  const override = process.env.MENARD_BUN;
  if (override && override.length > 0) return override;
  return findOnPath("bun");
}

function runtimeFrom(dir: string): string {
  const marker = join(dir, "runtime/src/alloc.c");
  if (existsSync(marker)) return join(dir, "runtime");
  if (dir === "/") return "runtime";
  const up = dirname(dir);
  if (up === dir) return "runtime";
  return runtimeFrom(up);
}

export function chosenRuntime(): string {
  if (existsSync("runtime/src/alloc.c")) return "runtime";
  return runtimeFrom(dirname(process.cwd()));
}

export function clangVersion(cc: string): string {
  if (!cc) return "unknown";
  return extractVersion(capture([cc, "--version"]));
}

/** Prefer `llvm-config --version`; fall back to clang only when config is absent. */
export function llvmVersion(cc: string): string {
  const fromConfig = (bin: string): string => {
    const out = firstNonEmptyLine(capture([bin, "--version"])).trim();
    return out.length > 0 ? extractVersion(out) : "";
  };
  const onPath = findOnPath("llvm-config");
  if (onPath) {
    const v = fromConfig(onPath);
    if (v.length > 0 && v !== "unknown") return v;
  }
  if (cc) {
    const beside = join(dirname(cc), "llvm-config");
    if (existsSync(beside)) {
      const v = fromConfig(beside);
      if (v.length > 0 && v !== "unknown") return v;
    }
  }
  return clangVersion(cc);
}

export function targetTriple(cc: string): string {
  if (!cc) return "unknown";
  const printed = firstNonEmptyLine(capture([cc, "-print-target-triple"])).trim();
  return printed || "unknown";
}

export function bunVersion(bun: string): string {
  if (!bun) return "unknown";
  const out = capture([bun, "--version"]).trim();
  return out.length > 0 ? firstNonEmptyLine(out) : "unknown";
}

export function opensslIncludeLib(): { include: string; lib: string } {
  const cflags = process.env.MENARD_OPENSSL_CFLAGS;
  const libs = process.env.MENARD_OPENSSL_LIBS;
  let include = "";
  let lib = "";
  const flagSrc =
    cflags !== undefined
      ? cflags
      : existsSync("/opt/homebrew/opt/openssl@3/include")
        ? "-I/opt/homebrew/opt/openssl@3/include"
        : existsSync("/usr/local/opt/openssl@3/include")
          ? "-I/usr/local/opt/openssl@3/include"
          : "";
  const libSrc =
    libs !== undefined
      ? libs
      : existsSync("/opt/homebrew/opt/openssl@3/lib")
        ? "-L/opt/homebrew/opt/openssl@3/lib -lssl -lcrypto"
        : existsSync("/usr/local/opt/openssl@3/lib")
          ? "-L/usr/local/opt/openssl@3/lib -lssl -lcrypto"
          : "-lssl -lcrypto";
  for (const tok of flagSrc.split(/\s+/)) {
    if (tok.startsWith("-I") && tok.length > 2) include = tok.slice(2);
  }
  for (const tok of libSrc.split(/\s+/)) {
    if (tok.startsWith("-L") && tok.length > 2) lib = tok.slice(2);
  }
  return { include, lib };
}

export function opensslVersion(): string {
  const bin = findOnPath("openssl");
  if (!bin) return "unknown";
  const v = extractVersion(capture([bin, "version"]));
  return v || "unknown";
}

export function formatToolchainReport(): string {
  const cc = chosenCc();
  const runtime = chosenRuntime();
  const bun = chosenBun();
  const { include, lib } = opensslIncludeLib();
  return (
    [
      `cc: ${cc}`,
      `runtime include: ${join(runtime, "include")}`,
      `runtime lib: ${runtime}`,
      `bun: ${bun}`,
      `llvm: ${llvmVersion(cc)}`,
      `openssl include: ${include}`,
      `openssl lib: ${lib}`,
      `openssl: ${opensslVersion()}`,
    ].join("\n") + "\n"
  );
}
