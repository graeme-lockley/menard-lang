/**
 * Plumbing for `make loop`: process execution, git, the run journal, and the
 * review-text extraction the prompts feed on.
 *
 * Nothing in here makes a decision about the backlog — that lives in run.ts.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

/** Run a command and capture both streams. Never throws; inspect `code`. */
export function run(command: string, args: string[], options: RunOptions = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: options.timeoutMs,
  });
  const error = result.error as (Error & { code?: string }) | undefined;
  const timedOut = error?.code === "ETIMEDOUT" || (result.status === null && result.signal === "SIGTERM");
  return {
    code: result.status ?? (timedOut ? 124 : 1),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut,
  };
}

export type StreamOptions = RunOptions & {
  /** Receive stdout line by line instead of echoing it raw. */
  onLine?: (line: string) => void;
  /** Echo both streams to the terminal as they arrive. */
  echo?: boolean;
};

/**
 * Run a command and stream its output as it arrives.
 *
 * `run()` buffers, which is right for `git` and `gh` and wrong for anything a
 * person is waiting on: an agent session can run for an hour, and a gate step
 * for minutes. This tees the child's streams to the terminal and still returns
 * the captured text.
 */
export async function runStreaming(
  command: string,
  args: string[],
  options: StreamOptions = {},
): Promise<RunResult> {
  const proc = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  let terminator: ReturnType<typeof setTimeout> | null = null;
  let killer: ReturnType<typeof setTimeout> | null = null;
  if (options.timeoutMs !== undefined) {
    terminator = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, options.timeoutMs);
    killer = setTimeout(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }, options.timeoutMs + 5000);
  }

  let lineBuffer = "";
  const onStdout = (text: string): void => {
    if (options.onLine === undefined) {
      if (options.echo === true) process.stdout.write(text);
      return;
    }
    lineBuffer += text;
    let index = lineBuffer.indexOf("\n");
    while (index !== -1) {
      const line = lineBuffer.slice(0, index).replace(/\r$/, "");
      lineBuffer = lineBuffer.slice(index + 1);
      options.onLine(line);
      index = lineBuffer.indexOf("\n");
    }
  };
  const onStderr = (text: string): void => {
    if (options.echo === true || options.onLine !== undefined) process.stderr.write(text);
  };

  const pump = async (stream: ReadableStream<Uint8Array>, sink: (text: string) => void): Promise<string> => {
    const decoder = new TextDecoder();
    let collected = "";
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true });
      collected += text;
      sink(text);
    }
    const rest = decoder.decode();
    collected += rest;
    sink(rest);
    return collected;
  };

  const [stdout, stderr] = await Promise.all([pump(proc.stdout, onStdout), pump(proc.stderr, onStderr)]);
  const code = await proc.exited;
  if (lineBuffer !== "") options.onLine?.(lineBuffer);

  if (terminator !== null) clearTimeout(terminator);
  if (killer !== null) clearTimeout(killer);

  return { code: code ?? (timedOut ? 124 : 1), stdout, stderr, timedOut };
}

/** Run git, and throw with git's own message when it fails. */
export function git(args: string[], options: RunOptions = {}): string {
  const result = run("git", args, options);
  if (result.code !== 0) {
    const reason = result.timedOut ? "timed out" : `exited ${result.code}`;
    throw new Error(`git ${args.join(" ")} ${reason}:\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

/** Everything a run leaves behind, under `.loop/<item>/`. */
export class Journal {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(this.dir, { recursive: true });
  }

  path(name: string): string {
    return join(this.dir, name);
  }

  log(message: string): void {
    const line = message.endsWith("\n") ? message : `${message}\n`;
    appendFileSync(this.path("run.log"), line);
    process.stdout.write(line);
  }

  banner(title: string): void {
    this.log(`\n=== ${title} ===`);
  }

  save(name: string, content: string): void {
    writeFileSync(this.path(name), content.endsWith("\n") ? content : `${content}\n`);
  }

  read(name: string): string | null {
    const path = this.path(name);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }
}

export type State = {
  item: string;
  branch: string;
  base: string;
  phase: string;
  rounds: number;
  startedAt: string;
};

export function readState(path: string): State | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof data !== "object" || data === null) return null;
    const record = data as Record<string, unknown>;
    for (const key of ["item", "branch", "base", "phase", "startedAt"]) {
      if (typeof record[key] !== "string") return null;
    }
    return {
      item: record["item"] as string,
      branch: record["branch"] as string,
      base: record["base"] as string,
      phase: record["phase"] as string,
      rounds: typeof record["rounds"] === "number" ? record["rounds"] : 0,
      startedAt: record["startedAt"] as string,
    };
  } catch {
    return null;
  }
}

export function writeState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * Pull one item's section out of the Build F review. The section is the
 * specification the plan and the reviewer both work from, so it is quoted
 * verbatim rather than summarised.
 */
export function extractReviewSection(markdown: string, id: string): string | null {
  const lines = markdown.split("\n");
  const heading = new RegExp(`^#{2,4}\\s+${id}\\b`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^#{1,3}\s/.test(lines[end] ?? "")) end += 1;
  const text = lines
    .slice(start, end)
    .filter((line) => !/^<a id=/.test(line))
    .join("\n")
    .trim();
  return text === "" ? null : text;
}

/** Keep the end of a failure log: that is where the cause usually is. */
export function tail(text: string, limit = 12000): string {
  const trimmed = text.trimEnd();
  if (trimmed.length <= limit) return trimmed;
  return `[… ${trimmed.length - limit} characters elided …]\n${trimmed.slice(-limit)}`;
}

/** Lowercase, hyphenated, at most `words` words — for branch names and log files. */
export function slug(text: string, words = 6): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/'s\b/g, "s")
    .split(/\s+/)
    .filter((part) => part !== "")
    .slice(0, words)
    .join("-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
