export type IoError =
  | { tag: "NotFound" }
  | { tag: "Permission" }
  | { tag: "Exists" }
  | { tag: "IsADirectory" }
  | { tag: "NotADirectory" }
  | { tag: "InvalidPath" }
  | { tag: "TooLarge" }
  | { tag: "Other"; code: bigint }
  | { tag: "Unsupported" };

export type Host = {
  writeStdout(bytes: Uint8Array): void;
  writeStderr(bytes: Uint8Array): void;
  readFile(path: string): { ok: true; bytes: Uint8Array } | { ok: false; error: IoError };
  writeFile(
    path: string,
    bytes: Uint8Array,
  ): { ok: true } | { ok: false; error: IoError };
  listDir(path: string): { ok: true; names: string[] } | { ok: false; error: IoError };
  /** When false, spawn returns Unsupported */
  spawnEnabled: boolean;
};

export type VirtualFs = {
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
};

export function createVirtualFs(seed?: Record<string, Uint8Array | string>): VirtualFs {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(["/"]);
  if (seed) {
    for (const [path, content] of Object.entries(seed)) {
      const bytes =
        typeof content === "string" ? new TextEncoder().encode(content) : content;
      files.set(normalize(path), bytes);
      ensureParentDirs(dirs, normalize(path));
    }
  }
  return { files, dirs };
}

function normalize(path: string): string {
  if (!path.startsWith("/")) path = "/" + path;
  const parts = path.split("/").filter((p) => p && p !== ".");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else out.push(p);
  }
  return "/" + out.join("/");
}

function ensureParentDirs(dirs: Set<string>, filePath: string): void {
  const parts = filePath.split("/").filter(Boolean);
  let cur = "";
  for (let i = 0; i < parts.length - 1; i++) {
    cur += "/" + parts[i];
    dirs.add(cur);
  }
}

export function createHost(
  opts: {
    fs?: VirtualFs;
    stdout?: Uint8Array[];
    stderr?: Uint8Array[];
    spawnEnabled?: boolean;
  } = {},
): Host & { stdout: Uint8Array[]; stderr: Uint8Array[]; fs: VirtualFs } {
  const fs = opts.fs ?? createVirtualFs();
  const stdout = opts.stdout ?? [];
  const stderr = opts.stderr ?? [];
  return {
    fs,
    stdout,
    stderr,
    spawnEnabled: opts.spawnEnabled ?? false,
    writeStdout(bytes) {
      stdout.push(bytes);
    },
    writeStderr(bytes) {
      stderr.push(bytes);
    },
    readFile(path) {
      const p = normalize(path);
      if (fs.dirs.has(p) && !fs.files.has(p)) {
        return { ok: false, error: { tag: "IsADirectory" } };
      }
      const b = fs.files.get(p);
      if (!b) return { ok: false, error: { tag: "NotFound" } };
      return { ok: true, bytes: b };
    },
    writeFile(path, bytes) {
      const p = normalize(path);
      if (fs.dirs.has(p) && !fs.files.has(p)) {
        return { ok: false, error: { tag: "IsADirectory" } };
      }
      ensureParentDirs(fs.dirs, p);
      fs.files.set(p, bytes.slice());
      return { ok: true };
    },
    listDir(path) {
      const p = normalize(path);
      if (fs.files.has(p) && !fs.dirs.has(p)) {
        return { ok: false, error: { tag: "NotADirectory" } };
      }
      if (p !== "/" && !fs.dirs.has(p) && !hasChildren(fs, p)) {
        return { ok: false, error: { tag: "NotFound" } };
      }
      const prefix = p === "/" ? "/" : p + "/";
      const names = new Set<string>();
      for (const f of fs.files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length);
          const name = rest.split("/")[0]!;
          if (name) names.add(name);
        }
      }
      for (const d of fs.dirs) {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          const name = rest.split("/")[0]!;
          if (name) names.add(name);
        }
      }
      return { ok: true, names: [...names].sort() };
    },
  };
}

function hasChildren(fs: VirtualFs, p: string): boolean {
  const prefix = p === "/" ? "/" : p + "/";
  for (const f of fs.files.keys()) if (f.startsWith(prefix)) return true;
  for (const d of fs.dirs) if (d.startsWith(prefix) && d !== p) return true;
  return false;
}
