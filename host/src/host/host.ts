import * as nodeFs from "node:fs";
import { spawnSync } from "node:child_process";
import * as os from "node:os";

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
  /** `(Maybe Str)` — `null` is None. */
  getenv(name: string): string | null;
  exists(path: string): boolean;
  rename(from: string, to: string): { ok: true } | { ok: false; error: IoError };
  /** stderr/stdout tty check. `fd` 1 is stdout, 2 is stderr. */
  isatty(fd: number): boolean;
  /** Milliseconds since the epoch, or 0 when missing. */
  mtime(path: string): bigint;
  cwd(): string;
  /** mkdir -p. */
  ensureDir(path: string): boolean;
  /** Absolute path, or "" when it cannot be resolved. */
  realpath(path: string): string;
  nowMs(): bigint;
  remove(path: string): boolean;
  isDir(path: string): boolean;
  /** Program arguments after CLI `--` (not including the script path). */
  argv: string[];
  /** Truncate to 8 bits and request process exit. Never returns. */
  exit(code: number): never;
  /** When false, spawn returns Unsupported */
  spawnEnabled: boolean;
  /**
   * Spawn a child with an argv vector (no shell). argv[0] is a path — bare
   * names mean `./name`, never a PATH search (§2.15).
   */
  spawn(argv: Uint8Array[]): SpawnOutcome;
  /** Like spawn, but pipes stdin and captures stdout/stderr. */
  spawnCapture(argv: Uint8Array[], stdin: Uint8Array): SpawnCaptureOutcome;
};

export type SpawnStatus =
  | { tag: "Exited"; code: number }
  | { tag: "Signalled"; signal: number };

export type SpawnError =
  | { tag: "NotFound" }
  | { tag: "NotExecutable" }
  | { tag: "Permission" }
  | { tag: "InvalidArgument" }
  | { tag: "TooManyArguments" }
  | { tag: "Unsupported" };

export type SpawnOutcome =
  | { ok: true; status: SpawnStatus }
  | { ok: false; error: SpawnError };

export type SpawnCaptureOutcome =
  | { ok: true; status: SpawnStatus; stdout: Uint8Array; stderr: Uint8Array }
  | { ok: false; error: SpawnError };

/** Map Node/Bun spawn failure codes into SpawnError. */
export function mapSpawnErrno(code: string | undefined): SpawnError {
  switch (code) {
    case "ENOENT":
      return { tag: "NotFound" };
    case "EACCES":
    case "EPERM":
      return { tag: "Permission" };
    case "ENOEXEC":
      return { tag: "NotExecutable" };
    case "E2BIG":
      return { tag: "TooManyArguments" };
    default:
      return { tag: "NotFound" };
  }
}

/** Validate argv: non-empty, no NULs (§2.15 rules 5). */
export function validateSpawnArgv(argv: Uint8Array[]): SpawnError | null {
  if (argv.length === 0) return { tag: "InvalidArgument" };
  for (const a of argv) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] === 0) return { tag: "InvalidArgument" };
    }
  }
  return null;
}

/** Bare names mean ./name — never PATH (§2.15 rule 2). */
export function resolveSpawnCmd(cmd: string): string {
  if (cmd.includes("/") || cmd.includes("\\")) return cmd;
  return "./" + cmd;
}

function spawnDisabled(): SpawnOutcome {
  return { ok: false, error: { tag: "Unsupported" } };
}

function spawnCaptureDisabled(): SpawnCaptureOutcome {
  return { ok: false, error: { tag: "Unsupported" } };
}

function decodeArgv(argv: Uint8Array[]): string[] {
  const dec = new TextDecoder();
  return argv.map((a) => dec.decode(a));
}

function signalNumber(name: string | null | undefined): number {
  if (!name) return 0;
  const n = (os.constants.signals as Record<string, number>)[name];
  return typeof n === "number" ? n : 0;
}

function runSpawn(
  argv: Uint8Array[],
  opts: { stdin?: Uint8Array; capture: boolean },
): SpawnOutcome | SpawnCaptureOutcome {
  const bad = validateSpawnArgv(argv);
  if (bad) return { ok: false, error: bad };
  const strings = decodeArgv(argv);
  const cmd = resolveSpawnCmd(strings[0]!);
  const args = strings.slice(1);
  try {
    const result = spawnSync(cmd, args, {
      shell: false,
      env: process.env,
      cwd: process.cwd(),
      stdio: opts.capture ? ["pipe", "pipe", "pipe"] : "inherit",
      input: opts.capture ? opts.stdin : undefined,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) {
      return {
        ok: false,
        error: mapSpawnErrno((result.error as NodeJS.ErrnoException).code),
      };
    }
    let status: SpawnStatus;
    if (result.signal) {
      status = { tag: "Signalled", signal: signalNumber(result.signal) };
    } else {
      status = { tag: "Exited", code: (result.status ?? 0) & 0xff };
    }
    if (opts.capture) {
      return {
        ok: true,
        status,
        stdout: new Uint8Array((result.stdout as Buffer | null) ?? []),
        stderr: new Uint8Array((result.stderr as Buffer | null) ?? []),
      };
    }
    return { ok: true, status };
  } catch (e) {
    return {
      ok: false,
      error: mapSpawnErrno((e as NodeJS.ErrnoException).code),
    };
  }
}

function spawnOps(enabled: boolean): Pick<Host, "spawn" | "spawnCapture"> {
  return {
    spawn(argv) {
      if (!enabled) return spawnDisabled();
      return runSpawn(argv, { capture: false }) as SpawnOutcome;
    },
    spawnCapture(argv, stdin) {
      if (!enabled) return spawnCaptureDisabled();
      return runSpawn(argv, { stdin, capture: true }) as SpawnCaptureOutcome;
    },
  };
}

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

function virtualOs(fs: VirtualFs): Pick<
  Host,
  "isatty" | "mtime" | "cwd" | "ensureDir" | "realpath" | "nowMs" | "remove" | "isDir"
> {
  return {
    isatty() {
      return false;
    },
    mtime(path) {
      const p = normalize(path);
      return fs.files.has(p) || fs.dirs.has(p) ? 1n : 0n;
    },
    cwd() {
      return "/";
    },
    ensureDir(path) {
      const p = normalize(path);
      ensureParentDirs(fs.dirs, p + "/x");
      fs.dirs.add(p);
      return true;
    },
    realpath(path) {
      const p = normalize(path);
      if (fs.files.has(p) || fs.dirs.has(p) || hasChildren(fs, p)) return p;
      return "";
    },
    nowMs() {
      return BigInt(Date.now());
    },
    remove(path) {
      return fs.files.delete(normalize(path));
    },
    isDir(path) {
      const p = normalize(path);
      if (fs.files.has(p)) return false;
      return fs.dirs.has(p) || hasChildren(fs, p);
    },
  };
}

/** A replaced stdout/stderr sink is not a terminal, even if the process's own fd is. */
function sinkIsTTY(sink: ByteSink): boolean {
  if (sink === process.stdout) return !!process.stdout.isTTY;
  if (sink === process.stderr) return !!process.stderr.isTTY;
  return false;
}

function realOs(): Pick<
  Host,
  "isatty" | "mtime" | "cwd" | "ensureDir" | "realpath" | "nowMs" | "remove" | "isDir"
> {
  return {
    isatty(fd) {
      if (fd === 1) return !!process.stdout.isTTY;
      if (fd === 2) return !!process.stderr.isTTY;
      return false;
    },
    mtime(path) {
      try {
        return BigInt(Math.trunc(nodeFs.statSync(path).mtimeMs));
      } catch {
        return 0n;
      }
    },
    cwd() {
      return process.cwd();
    },
    ensureDir(path) {
      try {
        nodeFs.mkdirSync(path, { recursive: true });
        return true;
      } catch {
        return false;
      }
    },
    realpath(path) {
      try {
        return nodeFs.realpathSync(path);
      } catch {
        return "";
      }
    },
    nowMs() {
      return BigInt(Date.now());
    },
    remove(path) {
      try {
        nodeFs.unlinkSync(path);
        return true;
      } catch {
        return false;
      }
    },
    isDir(path) {
      try {
        return nodeFs.statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

function hasChildren(fs: VirtualFs, p: string): boolean {
  const prefix = p === "/" ? "/" : p + "/";
  for (const f of fs.files.keys()) if (f.startsWith(prefix)) return true;
  for (const d of fs.dirs) if (d.startsWith(prefix) && d !== p) return true;
  return false;
}

function fsOps(fs: VirtualFs): Pick<Host, "readFile" | "writeFile" | "listDir" | "exists" | "rename"> {
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
    exists(path) {
      const p = normalize(path);
      return fs.files.has(p) || fs.dirs.has(p);
    },
    rename(from, to) {
      const a = normalize(from);
      const b = normalize(to);
      const bytes = fs.files.get(a);
      if (bytes === undefined) return { ok: false, error: { tag: "NotFound" } };
      if (fs.dirs.has(b) && !fs.files.has(b)) {
        return { ok: false, error: { tag: "IsADirectory" } };
      }
      fs.files.delete(a);
      ensureParentDirs(fs.dirs, b);
      fs.files.set(b, bytes);
      return { ok: true };
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
    env?: Record<string, string>;
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
  const spawnEnabled = opts.spawnEnabled ?? false;
  return {
    fs,
    stdout,
    stderr,
    argv: opts.argv ?? [],
    spawnEnabled,
    writeStdout,
    writeStderr,
    writeFd(fd, bytes) {
      return writeFdVirtual(fd, bytes, writeStdout, writeStderr);
    },
    exit(code) {
      throw new ExitSignal(code & 0xff);
    },
    ...fsOps(fs),
    ...spawnOps(spawnEnabled),
    ...virtualOs(fs),
    getenv(name) {
      const env = opts.env ?? {};
      const v = env[name];
      return v === undefined ? null : v;
    },
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
  const spawnEnabled = opts.spawnEnabled ?? false;
  return {
    fs,
    argv: opts.argv ?? [],
    spawnEnabled,
    writeStdout,
    writeStderr,
    writeFd(fd, bytes) {
      return writeFdVirtual(fd, bytes, writeStdout, writeStderr);
    },
    exit(code) {
      throw new ExitSignal(code & 0xff);
    },
    ...fsOps(fs),
    ...spawnOps(spawnEnabled),
    ...virtualOs(fs),
    getenv(name) {
      const v = process.env[name];
      return v === undefined ? null : v;
    },
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

  const spawnEnabled = opts.spawnEnabled ?? false;
  return {
    argv: opts.argv ?? [],
    spawnEnabled,
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
    getenv(name) {
      const v = process.env[name];
      return v === undefined ? null : v;
    },
    exists(path) {
      try {
        nodeFs.statSync(path);
        return true;
      } catch {
        return false;
      }
    },
    rename(from, to) {
      try {
        nodeFs.renameSync(from, to);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: mapNodeErrno((e as NodeJS.ErrnoException).code) };
      }
    },
    exit(code) {
      throw new ExitSignal(code & 0xff);
    },
    ...spawnOps(spawnEnabled),
    ...realOs(),
    isatty(fd) {
      if (fd === 1) return sinkIsTTY(out);
      if (fd === 2) return sinkIsTTY(err);
      return false;
    },
  };
}
