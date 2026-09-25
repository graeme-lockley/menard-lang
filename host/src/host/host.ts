import * as nodeFs from "node:fs";

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

/** Thrown by Host.exit — evaluator treats as program-requested termination. */
export class ExitSignal {
  constructor(readonly code: number) {}
}

export type Host = {
  writeStdout(bytes: Uint8Array): void;
  writeStderr(bytes: Uint8Array): void;
  /** Raw bytes to an fd; fd 1/2 are stdout/stderr. */
  writeFd(fd: number, bytes: Uint8Array): { ok: true } | { ok: false; error: IoError };
  readFile(path: string): { ok: true; bytes: Uint8Array } | { ok: false; error: IoError };
  writeFile(
    path: string,
    bytes: Uint8Array,
  ): { ok: true } | { ok: false; error: IoError };
  listDir(path: string): { ok: true; names: string[] } | { ok: false; error: IoError };
  /** Program arguments after CLI `--` (not including the script path). */
  argv: string[];
  /** Truncate to 8 bits and request process exit. Never returns. */
  exit(code: number): never;
  /** When false, spawn returns Unsupported */
  spawnEnabled: boolean;
};

/** Map Node/Bun `error.code` strings into the closed Menard IoError taxonomy. */
export function mapNodeErrno(code: string | undefined): IoError {
  switch (code) {
    case "ENOENT":
      return { tag: "NotFound" };
    case "EACCES":
    case "EPERM":
      return { tag: "Permission" };
    case "EEXIST":
      return { tag: "Exists" };
    case "EISDIR":
      return { tag: "IsADirectory" };
    case "ENOTDIR":
      return { tag: "NotADirectory" };
    case "EINVAL":
    case "ENAMETOOLONG":
      return { tag: "InvalidPath" };
    case "EFBIG":
      return { tag: "TooLarge" };
    default: {
      // Stable Menard code, not errno — hash the name into a small positive int.
      let n = 0n;
      if (code) {
        for (let i = 0; i < code.length; i++) n = (n * 31n + BigInt(code.charCodeAt(i)!)) & 0xffffn;
      }
      return { tag: "Other", code: n === 0n ? 1n : n };
    }
  }
}

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

function hasChildren(fs: VirtualFs, p: string): boolean {
  const prefix = p === "/" ? "/" : p + "/";
  for (const f of fs.files.keys()) if (f.startsWith(prefix)) return true;
  for (const d of fs.dirs) if (d.startsWith(prefix) && d !== p) return true;
  return false;
}

function fsOps(fs: VirtualFs): Pick<Host, "readFile" | "writeFile" | "listDir"> {
  return {
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

function writeFdVirtual(
  fd: number,
  bytes: Uint8Array,
  writeStdout: (b: Uint8Array) => void,
  writeStderr: (b: Uint8Array) => void,
): { ok: true } | { ok: false; error: IoError } {
  if (fd === 1) {
    writeStdout(bytes);
    return { ok: true };
  }
  if (fd === 2) {
    writeStderr(bytes);
    return { ok: true };
  }
  return { ok: false, error: { tag: "Unsupported" } };
}

/** Buffering host for hermetic tests — capture stdout/stderr in arrays. */
export function createHost(
  opts: {
    fs?: VirtualFs;
    stdout?: Uint8Array[];
    stderr?: Uint8Array[];
    spawnEnabled?: boolean;
    argv?: string[];
  } = {},
): Host & { stdout: Uint8Array[]; stderr: Uint8Array[]; fs: VirtualFs } {
  const fs = opts.fs ?? createVirtualFs();
  const stdout = opts.stdout ?? [];
  const stderr = opts.stderr ?? [];
  const writeStdout = (bytes: Uint8Array) => {
    stdout.push(bytes);
  };
  const writeStderr = (bytes: Uint8Array) => {
    stderr.push(bytes);
  };
  return {
    fs,
    stdout,
    stderr,
    argv: opts.argv ?? [],
    spawnEnabled: opts.spawnEnabled ?? false,
    writeStdout,
    writeStderr,
    writeFd(fd, bytes) {
      return writeFdVirtual(fd, bytes, writeStdout, writeStderr);
    },
    exit(code) {
      throw new ExitSignal(code & 0xff);
    },
    ...fsOps(fs),
  };
}

export type ByteSink = { write(chunk: Uint8Array): unknown };

/**
 * Live host for the CLI — print/println/dump write immediately to the given
 * sinks (default: process.stdout / process.stderr). Uses a virtual FS unless
 * `realFs` is set.
 */
export function createLiveHost(
  opts: {
    fs?: VirtualFs;
    spawnEnabled?: boolean;
    stdout?: ByteSink;
    stderr?: ByteSink;
    argv?: string[];
    realFs?: boolean;
  } = {},
): Host & { fs?: VirtualFs } {
  const out = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const writeStdout = (bytes: Uint8Array) => {
    out.write(bytes);
  };
  const writeStderr = (bytes: Uint8Array) => {
    err.write(bytes);
  };

  if (opts.realFs) {
    return createRealHost({
      stdout: out,
      stderr: err,
      argv: opts.argv,
      spawnEnabled: opts.spawnEnabled,
    });
  }

  const fs = opts.fs ?? createVirtualFs();
  return {
    fs,
    argv: opts.argv ?? [],
    spawnEnabled: opts.spawnEnabled ?? false,
    writeStdout,
    writeStderr,
    writeFd(fd, bytes) {
      return writeFdVirtual(fd, bytes, writeStdout, writeStderr);
    },
    exit(code) {
      throw new ExitSignal(code & 0xff);
    },
    ...fsOps(fs),
  };
}

/**
 * Real-filesystem host for stage0 — paths are OS paths, no virtual normalize.
 */
export function createRealHost(
  opts: {
    stdout?: ByteSink;
    stderr?: ByteSink;
    argv?: string[];
    spawnEnabled?: boolean;
  } = {},
): Host {
  const out = opts.stdout ?? process.stdout;
  const err = opts.stderr ?? process.stderr;
  const writeStdout = (bytes: Uint8Array) => {
    out.write(bytes);
  };
  const writeStderr = (bytes: Uint8Array) => {
    err.write(bytes);
  };

  return {
    argv: opts.argv ?? [],
    spawnEnabled: opts.spawnEnabled ?? false,
    writeStdout,
    writeStderr,
    writeFd(fd, bytes) {
      if (fd === 1) {
        writeStdout(bytes);
        return { ok: true };
      }
      if (fd === 2) {
        writeStderr(bytes);
        return { ok: true };
      }
      try {
        nodeFs.writeSync(fd, bytes);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: mapNodeErrno((e as NodeJS.ErrnoException).code) };
      }
    },
    readFile(path) {
      try {
        return { ok: true, bytes: new Uint8Array(nodeFs.readFileSync(path)) };
      } catch (e) {
        return { ok: false, error: mapNodeErrno((e as NodeJS.ErrnoException).code) };
      }
    },
    writeFile(path, bytes) {
      try {
        nodeFs.writeFileSync(path, bytes);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: mapNodeErrno((e as NodeJS.ErrnoException).code) };
      }
    },
    listDir(path) {
      try {
        const names = nodeFs.readdirSync(path).slice().sort();
        return { ok: true, names };
      } catch (e) {
        return { ok: false, error: mapNodeErrno((e as NodeJS.ErrnoException).code) };
      }
    },
    exit(code) {
      throw new ExitSignal(code & 0xff);
    },
  };
}
