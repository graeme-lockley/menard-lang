import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  bunVersion,
  chosenBun,
  chosenCc,
  clangVersion,
  findOnPath,
  llvmVersion,
  opensslVersion,
  targetTriple,
} from "./toolchain.ts";

function capture(argv: string[]): string {
  if (argv.length === 0) return "";
  const [cmd, ...args] = argv;
  const r = spawnSync(cmd!, args, {
    encoding: "utf-8",
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

/** Walk up from `start` looking for a file named `name`. */
export function findUp(name: string, start = process.cwd()): string | null {
  let dir = start;
  for (;;) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readMenardVersion(cwd = process.cwd()): string {
  const path = findUp("VERSION", cwd);
  if (!path) return "0.0.0";
  return readFileSync(path, "utf-8").trim() || "0.0.0";
}

function gitShaAndDirty(): { sha: string; dirty: boolean } {
  const git = findOnPath("git");
  if (!git) return { sha: "unknown", dirty: false };
  const sha = firstNonEmptyLine(capture([git, "rev-parse", "--short", "HEAD"])).trim();
  if (!sha) return { sha: "unknown", dirty: false };
  const porcelain = capture([git, "status", "--porcelain"]).trim();
  return { sha, dirty: porcelain.length > 0 };
}

/** Commit date (`YYYY-MM-DD`) from git; the review-scope build date. */
export function buildDate(): string {
  const git = findOnPath("git");
  if (!git) return "unknown";
  const d = firstNonEmptyLine(capture([git, "log", "-1", "--format=%cs"])).trim();
  return d.length > 0 ? d : "unknown";
}

/** Optional `project name version` line when a walk-up finds project.mnd. */
export function projectLine(cwd = process.cwd()): string | null {
  const path = findUp("project.mnd", cwd);
  if (!path) return null;
  let src = "";
  try {
    src = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  const m = /package\s+"([^"]+)"\s+@\s+"([^"]+)"/.exec(src);
  if (!m) return null;
  return `project ${m[1]} ${m[2]}`;
}

export function formatVersionReport(cwd = process.cwd()): string {
  const semver = readMenardVersion(cwd);
  const { sha, dirty } = gitShaAndDirty();
  const menard = dirty
    ? `menard ${semver} (${sha}, dirty)`
    : `menard ${semver} (${sha})`;
  const lines = [menard];
  const project = projectLine(cwd);
  if (project) lines.push(project);
  lines.push(`built ${buildDate()}`);
  const cc = chosenCc();
  const bun = chosenBun();
  lines.push(`bun ${bunVersion(bun)}`);
  lines.push(`clang ${clangVersion(cc)}`);
  lines.push(`openssl ${opensslVersion()}`);
  lines.push(`llvm ${llvmVersion(cc)}`);
  lines.push(`target ${targetTriple(cc)}`);
  return lines.join("\n") + "\n";
}
