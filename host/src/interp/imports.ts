import { spawnSync } from "node:child_process";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

const dec = new TextDecoder();

export function decodeBytes(bytes: Uint8Array): string {
  return dec.decode(bytes);
}

export type GithubSpec = {
  owner: string;
  repo: string;
  version: string;
  modulePath: string;
};

/** `github:owner/repo@version/module` — module may contain slashes. */
export function parseGithubSpec(spec: string): GithubSpec | null {
  if (!spec.startsWith("github:")) return null;
  const rest = spec.slice("github:".length);
  const at = rest.indexOf("@");
  if (at <= 0) return null;
  const ownerRepo = rest.slice(0, at);
  const slash = ownerRepo.indexOf("/");
  if (slash <= 0 || slash !== ownerRepo.lastIndexOf("/")) return null;
  const owner = ownerRepo.slice(0, slash);
  const repo = ownerRepo.slice(slash + 1);
  if (!owner || !repo) return null;
  const after = rest.slice(at + 1);
  const vslash = after.indexOf("/");
  if (vslash <= 0 || vslash === after.length - 1) return null;
  const version = after.slice(0, vslash);
  const modulePath = after.slice(vslash + 1);
  if (!version || !modulePath || modulePath.startsWith("/") || modulePath.includes("..")) {
    return null;
  }
  return { owner, repo, version, modulePath };
}

export function githubKey(spec: GithubSpec): string {
  return `${spec.owner}/${spec.repo}`;
}

export function withMnd(path: string): string {
  return path.endsWith(".mnd") ? path : `${path}.mnd`;
}

/** `std/list` → `stdlib/list.mnd`. Independent of the importing file. */
export function stdPath(spec: string): string {
  const name = spec.startsWith("std/") ? spec.slice("std/".length) : spec;
  return `stdlib/${withMnd(name)}`;
}

export function depsRoot(home: string | null): string {
  if (home && home.length > 0) return `${home}/.menard/deps`;
  return ".menard/deps";
}

export function githubCacheFile(spec: GithubSpec, home: string | null): string {
  return `${depsRoot(home)}/${spec.owner}/${spec.repo}/${spec.version}/${withMnd(spec.modulePath)}`;
}

export function githubTreeDir(spec: GithubSpec, home: string | null): string {
  return `${depsRoot(home)}/${spec.owner}/${spec.repo}/${spec.version}`;
}

export function githubTarballUrl(spec: GithubSpec): string {
  return `https://codeload.github.com/${spec.owner}/${spec.repo}/tar.gz/refs/tags/${spec.version}`;
}

export function isBasicsPath(path: string): boolean {
  return path === "stdlib/basics.mnd" || path.endsWith("/stdlib/basics.mnd");
}

export function isBasicsSpec(spec: string): boolean {
  return spec === "std/basics" || spec === "std/basics.mnd";
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return path.slice(0, i);
}

function normalizeRel(path: string): string {
  const abs = path.startsWith("/");
  const parts = path.split("/").filter((p) => p && p !== ".");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") {
      if (out.length) out.pop();
    } else out.push(p);
  }
  const s = out.join("/");
  if (abs) return "/" + s;
  return s || ".";
}

/**
 * Resolve one import specifier.
 * `std/…` is the shipped library, `github:owner/repo@version/module` is the
 * cache path, and every other spec is relative to the importing file.
 */
export function resolveImportPath(fromPath: string, spec: string, home: string | null = null): string {
  if (spec.startsWith("std/")) return stdPath(spec);
  if (spec.startsWith("github:")) {
    const gh = parseGithubSpec(spec);
    if (!gh) return spec;
    return githubCacheFile(gh, home);
  }
  if (spec.startsWith("/")) return normalizeRel(spec);
  const fromDir = dirname(fromPath);
  const joined = fromDir === "." || fromDir === "" ? spec : `${fromDir}/${spec}`;
  return normalizeRel(joined);
}

export type VersionClash = { key: string; previous: string; next: string };

/** Record `owner/repo` → version. A second version is a clash. */
export function noteGithubVersion(
  versions: Map<string, string>,
  spec: string,
): VersionClash | null {
  const gh = parseGithubSpec(spec);
  if (!gh) return null;
  const key = githubKey(gh);
  const prev = versions.get(key);
  if (prev !== undefined && prev !== gh.version) {
    return { key, previous: prev, next: gh.version };
  }
  versions.set(key, gh.version);
  return null;
}

export function versionClashMessage(clash: VersionClash): string {
  return `two versions of ${clash.key}: ${clash.previous} and ${clash.next}`;
}

/**
 * Download a tag archive into the deps cache. A file that is already there
 * is left untouched, so tests can seed the cache and skip the network.
 * The bytes come from `fetch` in a small Bun process; extraction is `tar`.
 */
export function ensureGithubTree(spec: GithubSpec, home: string | null): { ok: true } | { ok: false; message: string } {
  const dir = githubTreeDir(spec, home);
  const wanted = githubCacheFile(spec, home);
  if (nodeFs.existsSync(wanted)) return { ok: true };
  nodeFs.mkdirSync(dir, { recursive: true });
  const tgz = nodePath.join(dir, ".src.tgz");
  const url = githubTarballUrl(spec);
  const script = `
    const url = process.argv[process.argv.length - 2];
    const dest = process.argv[process.argv.length - 1];
    const res = await fetch(url);
    if (!res.ok) process.exit(1);
    await Bun.write(dest, new Uint8Array(await res.arrayBuffer()));
  `;
  const downloaded = spawnSync(process.execPath, ["-e", script, url, tgz], { encoding: "utf8" });
  if (downloaded.status !== 0) {
    return { ok: false, message: `cannot fetch ${url}` };
  }
  const extracted = spawnSync("/usr/bin/tar", ["-xzf", tgz, "-C", dir, "--strip-components=1"], {
    encoding: "utf8",
  });
  nodeFs.rmSync(tgz, { force: true });
  if (extracted.status !== 0) return { ok: false, message: `cannot extract ${url}` };
  if (!nodeFs.existsSync(wanted)) {
    return { ok: false, message: `module not found: ${wanted}` };
  }
  return { ok: true };
}
