#!/usr/bin/env bun
/**
 * Stub child for spawn tests (§3.7 / §3.10).
 * Usage: stub-child <mode> [args…]
 *
 *   exit <n>       exit with status n (0..255)
 *   echo-argv      write each argv element after the mode as a line of hex, exit 0
 *   cat-stdin      copy stdin bytes to stdout, exit 0
 *   fail-enoent    never: the test points argv[0] at a missing path instead
 */
const args = process.argv.slice(2);
const mode = args[0];
if (!mode) {
  process.stderr.write("stub-child: missing mode\n");
  process.exit(2);
}

if (mode === "exit") {
  const n = Number(args[1] ?? "0");
  process.exit(n & 0xff);
}

if (mode === "echo-argv") {
  for (const a of args.slice(1)) {
    const bytes = Buffer.from(a, "utf8");
    process.stdout.write(bytes.toString("hex") + "\n");
  }
  process.exit(0);
}

if (mode === "cat-stdin") {
  const chunks: Buffer[] = [];
  for await (const c of Bun.stdin.stream()) chunks.push(Buffer.from(c));
  process.stdout.write(Buffer.concat(chunks));
  process.exit(0);
}

process.stderr.write(`stub-child: unknown mode ${mode}\n`);
process.exit(2);
