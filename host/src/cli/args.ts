export type ParsedCliArgs = {
  cmd: "check" | "run";
  file: string;
  showResult: boolean;
  json: boolean;
  argv: string[];
};

export type ParsedCliHelp =
  | { kind: "commands" }
  | { kind: "command"; cmd: "check" | "run" | "fix" | "fmt" };

/**
 * Parse `menard <check|run> [--show-result] [--json] <file.mnd> [-- arg…]`.
 * Returns null on usage error.
 */
export function parseCliArgs(args: string[]): ParsedCliArgs | null {
  const showResult = args.includes("--show-result");
  const json = args.includes("--json");
  const dash = args.indexOf("--");
  const before = (dash >= 0 ? args.slice(0, dash) : args).filter(
    (a) => a !== "--show-result" && a !== "--json",
  );
  const argv = dash >= 0 ? args.slice(dash + 1) : [];
  const [cmd, file] = before;
  if (!cmd || !file || (cmd !== "check" && cmd !== "run")) return null;
  if (before.length !== 2) return null;
  return { cmd, file, showResult, json, argv };
}

/**
 * Detect `menard --help` or `menard <check|run|fix|fmt> --help`.
 * Returns null when the argv is not a help request.
 */
export function parseCliHelp(args: string[]): ParsedCliHelp | null {
  if (args.length === 1 && args[0] === "--help") return { kind: "commands" };
  if (args.length === 2 && args[1] === "--help") {
    const cmd = args[0];
    if (cmd === "check" || cmd === "run" || cmd === "fix" || cmd === "fmt") {
      return { kind: "command", cmd };
    }
  }
  return null;
}

export function formatCommandsHelp(): string {
  return (
    "menard commands:\n" +
    "  check   Typecheck a .mnd file\n" +
    "  run     Typecheck and run a .mnd file\n" +
    "  fmt     Format .mnd files (operator spacing)\n" +
    "  fix     Apply fix suggestions to .mnd files\n"
  );
}

export function formatCommandHelp(cmd: "check" | "run" | "fix" | "fmt"): string {
  if (cmd === "fmt") {
    return "usage: menard fmt <file.mnd…>\n";
  }
  if (cmd === "fix") {
    return (
      "usage: menard fix [--dry-run] [--rule name] <file.mnd…>\n" +
      "  --dry-run   Show changes without writing\n" +
      "  --rule name Apply only the named rule\n"
    );
  }
  if (cmd === "check") {
    return (
      "usage: menard check [--json] <file.mnd>\n" +
      "  --json   Machine-readable diagnostics on stdout\n"
    );
  }
  return (
    "usage: menard run [--show-result] [--json] <file.mnd> [-- arg…]\n" +
    "  --show-result   Print the final non-Unit value\n" +
    "  --json          Machine-readable diagnostics on stdout\n"
  );
}
