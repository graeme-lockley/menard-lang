export type ParsedCliArgs = {
  cmd: "check" | "run";
  file: string;
  showResult: boolean;
  argv: string[];
};

/**
 * Parse `menard <check|run> [--show-result] <file.mnd> [-- arg…]`.
 * Returns null on usage error.
 */
export function parseCliArgs(args: string[]): ParsedCliArgs | null {
  const showResult = args.includes("--show-result");
  const dash = args.indexOf("--");
  const before = (dash >= 0 ? args.slice(0, dash) : args).filter((a) => a !== "--show-result");
  const argv = dash >= 0 ? args.slice(dash + 1) : [];
  const [cmd, file] = before;
  if (!cmd || !file || (cmd !== "check" && cmd !== "run")) return null;
  if (before.length !== 2) return null;
  return { cmd, file, showResult, argv };
}
