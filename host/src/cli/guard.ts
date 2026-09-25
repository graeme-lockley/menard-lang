/**
 * Map unexpected interpreter/host exceptions to exit code 2 with a single-line
 * stderr message. Stack traces stay behind showStack (MENARD_STACK=1).
 */

export function formatInternalError(err: unknown, showStack: boolean): string {
  const msg =
    err instanceof Error
      ? err.message || err.name
      : typeof err === "string"
        ? err
        : String(err);
  let out = `internal error: ${msg}\n`;
  if (showStack && err instanceof Error && err.stack) {
    out += err.stack + "\n";
  }
  return out;
}

export type InternalGuardIo = {
  writeStderr: (s: string) => void;
  exit: (code: number) => void;
  showStack: boolean;
};

/** Run action; on unexpected throw, report and exit(2). Does not return after a fault. */
export function withInternalGuard(action: () => void, io: InternalGuardIo): void {
  try {
    action();
  } catch (e) {
    io.writeStderr(formatInternalError(e, io.showStack));
    io.exit(2);
  }
}
