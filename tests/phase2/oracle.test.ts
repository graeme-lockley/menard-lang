/**
 * Phase 2 slice 2D/2H — the interp <-> native oracle.
 *
 * Slice 2B's `oracle.test.ts` only checked the *native* side of each
 * fixture in `tests/phase2/oracle/*.mnd` against a hardcoded expected
 * exit code — proving `emit` produces a real, linkable, correctly-valued
 * `.bc`, but never checking that value against anything the interpreter
 * itself computed, and (slice 2B/2G) never checking that the emitted
 * module actually *computes* anything rather than having its result
 * folded to a constant at compile time. This slice closes both gaps:
 * for each fixture, the program is run *twice* — once by the TypeScript
 * reference interpreter (host/src/interp), once compiled to native
 * code — and the two results are asserted equal to each other, not just
 * to a hardcoded number; and the emitted module's `llvm-dis` text is
 * asserted to actually contain the instruction its fixture name claims
 * (`add`, `call`, …), not merely `ret i32 N` — see `src/emit/lower.mnd`'s
 * header comment for what replaced the constant-folder this test
 * previously tolerated. Only then is the hardcoded `expectExit` checked
 * too, as a sanity anchor confirming the shared expectation itself
 * hasn't drifted from what the fixture's header comment claims.
 *
 * ## The interp <-> native protocol
 *
 * - **Native:** the process exit code is `main`'s `Int` return, per the
 *   C `main` the emitted `.bc` defines.
 * - **Interpreter:** each fixture ends with a top-level `(defn main ->
 *   Int …)` and nothing else; `evalProgram` (host/src/interp/eval.ts)
 *   automatically calls `main` after the top-level forms and returns its
 *   value as the program's result — so `run()`'s `result.value` *is*
 *   the same `Int` native's `main` returns, needing no fixture-visible
 *   `(main)` call. Truncating that `Int` to 8 bits, unsigned
 *   (`BigInt.asUintN(8, …)`), matches how a process exit code is itself
 *   truncated to `[0, 256)` by the OS (`& 0xff`, spec-consistent with
 *   `Host.exit`'s own `code & 0xff` in host/src/host/host.ts).
 * - **stdout:** empty for every fixture that never calls `print`/
 *   `println`/`write`; `println-hello.mnd` (added alongside `src/emit/
 *   lower.mnd`'s `println`/`print`/`write` lowering) does call
 *   `println`, and both sides' captured stdout bytes are asserted equal
 *   to each other (not just to a hardcoded string) — the same "agree
 *   with each other, not just a hardcoded answer" discipline the exit
 *   code comparison below already has. `hello.mnd` itself (`(println
 *   "Hello, world!")`, `123`, `(defn main -> Int 0)`) is covered by
 *   `tests/phase2/emit-link.test.ts` and `tests/phase2/bc-writer.test.ts`
 *   instead, which both now also assert its stdout.
 *
 * Compiled against the real runtime (`RUNTIME_LIB_SRCS`, matching the
 * Makefile's `ret-native`/`hello-native` — slice 2C), not the bare `.bc`
 * `emit-link.test.ts` still links: these fixtures don't call into the
 * runtime yet either, but linking against it now is what the Makefile
 * targets this test mirrors will keep doing once a fixture does.
 *
 * Not hermetic: spawns real `clang`/`llvm-dis` processes and executes a
 * real binary. Skipped (not failed) when either is not on `PATH` — see
 * `emit-link.test.ts` for the same convention.
 *
 * `ret-loop.mnd` and `ret-match.mnd` are active oracle fixtures (slices
 * 3A / 3C). `ret-bool-unit.mnd` covers Bool/Unit immediates (slice 3B).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, unlink, mkdtemp } from "node:fs";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../host/src/interp/pipeline.ts";
import { createLiveHost } from "../../host/src/host/index.ts";

const rm = promisify(unlink);
const mkdtempP = promisify(mkdtemp);

const ROOT = join(import.meta.dir, "..", "..");

function abs(relPath: string): string {
  return join(ROOT, relPath);
}

const clang = Bun.which("clang");
const llvmDis = Bun.which("llvm-dis");

// The runtime a compiled Menard program links against (Makefile's
// RUNTIME_LIB_SRCS — slice 2C): alloc + panic + the fd-1 print helpers +
// the (stub) shadow-stack rooting ABI. Never smoke_main.c, which defines
// its own `main` and would collide with the emitted module's.
const RUNTIME_LIB_SRCS = [
  "runtime/src/alloc.c",
  "runtime/src/panic.c",
  "runtime/src/print.c",
  "runtime/src/shadow.c",
  "runtime/src/variants.c",
  "runtime/src/str.c",
  "runtime/src/map.c",
  "runtime/src/closure.c",
  "runtime/src/io.c",
].map(abs);
const RUNTIME_INCLUDE = abs("runtime/include");

/** Run `src/main.mnd emit <entry> <out>` exactly as the CLI would. */
function emit(entryRelPath: string, outPath: string): { exitCode: number; stderr: string } {
  const entryPath = abs("src/main.mnd");
  const source = readFileSync(entryPath);
  const stderrChunks: Uint8Array[] = [];
  const host = createLiveHost({
    realFs: true,
    argv: ["emit", abs(entryRelPath), outPath],
    stdout: { write: () => {} },
    stderr: { write: (b: Uint8Array) => stderrChunks.push(b) },
  });
  const dec = new TextDecoder();
  const r = run(source, { path: entryPath, host });
  const stderr = stderrChunks.map((b) => dec.decode(b)).join("");
  if (r.ok) return { exitCode: r.exitCode ?? 0, stderr };
  if (r.kind === "diagnostics") {
    return { exitCode: 2, stderr: stderr + JSON.stringify(r.diagnostics) };
  }
  return { exitCode: 2, stderr: stderr + "[panic] " + r.message };
}

/**
 * Run `entryRelPath` directly in the reference interpreter (as `menard
 * run` would — host/src/cli/menard.ts) and reduce its result to the same
 * shape a native run produces: a process-style exit code, plus captured
 * stdout/stderr. See this file's header comment for the `Int` ->
 * exit-code protocol.
 */
function interpret(entryRelPath: string): { exitCode: number; stdout: string; stderr: string } {
  const entryPath = abs(entryRelPath);
  const source = readFileSync(entryPath);
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  const host = createLiveHost({
    realFs: true,
    argv: [],
    stdout: { write: (b: Uint8Array) => stdoutChunks.push(b) },
    stderr: { write: (b: Uint8Array) => stderrChunks.push(b) },
  });
  const dec = new TextDecoder();
  const r = run(source, { path: entryPath, host });
  const stdout = stdoutChunks.map((b) => dec.decode(b)).join("");
  const stderr = stderrChunks.map((b) => dec.decode(b)).join("");
  if (!r.ok) {
    const detail = r.kind === "diagnostics" ? JSON.stringify(r.diagnostics) : r.message;
    throw new Error(`interpreter failed for ${entryRelPath}: ${detail}`);
  }
  // An explicit `(exit n)` wins if a fixture ever calls it; these
  // fixtures don't, so this falls through to the auto-called `main`'s
  // `Int` result instead (see header comment).
  if (r.exitCode !== undefined) {
    return { exitCode: r.exitCode, stdout, stderr };
  }
  if (r.value.tag !== "int") {
    throw new Error(
      `interpreter did not produce an Int main result for ${entryRelPath}: got ${r.value.tag}`,
    );
  }
  const exitCode = Number(BigInt.asUintN(8, r.value.value));
  return { exitCode, stdout, stderr };
}

const fixtures: Array<{
  name: string;
  entry: string;
  expectExit: number;
  expectDis: RegExp;
  expectStdout?: string;
}> = [
  {
    name: "a literal `main` lowers to a real untag/trunc/ret sequence (no `add`/`call` needed)",
    entry: "tests/phase2/oracle/ret41.mnd",
    expectExit: 41,
    expectDis: /\bret i32\b/,
  },
  {
    name: "`(+ 20 22)` lowers to a real tagged `add` (not a folded `ret i32 42`)",
    entry: "tests/phase2/oracle/ret-add.mnd",
    expectExit: 42,
    expectDis: /\badd i64\b/,
  },
  {
    name: "a call to another pure-Int defn lowers to a real `call`",
    entry: "tests/phase2/oracle/ret-call.mnd",
    expectExit: 42,
    expectDis: /\bcall i64\b/,
  },
  {
    name: "a nested `fn` becomes a heap closure (`mn_closure_new` / `mn_apply_1`)",
    entry: "tests/phase2/oracle/ret-closure.mnd",
    expectExit: 41,
    expectDis: /\bcall i64 @mn_(closure_new|apply_1)\b/,
  },
  {
    name: "a standalone top-level `(println ...)` lowers to a real `mn_write_stdout` call, prepended into `main`",
    entry: "tests/phase2/oracle/println-hello.mnd",
    expectExit: 7,
    expectDis: /\bcall void @mn_write_stdout\b/,
    expectStdout: "Hello, oracle!\n",
  },
  {
    name: "`loop`/`recur` lowers to a real back-edge (`br` to an earlier block), computing sum-to 10 = 55",
    entry: "tests/phase2/oracle/ret-loop.mnd",
    expectExit: 55,
    expectDis: /\bbr label %/,
  },
  {
    name: "Bool/Unit immediates: Bool locals, Bool-returning helpers, Unit mid-sequence (exit 1)",
    entry: "tests/phase2/oracle/ret-bool-unit.mnd",
    expectExit: 1,
    expectDis: /\bicmp /,
  },
  {
    name: "`match` on Cons/Nil list-sum lowers via mn_tag/mn_slot (exit 60)",
    entry: "tests/phase2/oracle/ret-match.mnd",
    expectExit: 60,
    expectDis: /\bcall i64 @mn_(tag|cons|nil)\b/,
  },
  {
    name: "Str concat + write (stdout hello\\n, exit 5)",
    entry: "tests/phase2/oracle/ret-strings.mnd",
    expectExit: 5,
    expectDis: /\bcall i64 @mn_str_concat\b/,
    expectStdout: "hello\n",
  },
  {
    name: "Ref + loop mutation (sum 0..10 = 55)",
    entry: "tests/phase2/oracle/ret-ref.mnd",
    expectExit: 55,
    expectDis: /\bcall i64 @mn_ref_(new|deref|set)\b/,
  },
  {
    name: "Map set/get/size (exit 12)",
    entry: "tests/phase2/oracle/ret-map.mnd",
    expectExit: 12,
    expectDis: /\bcall i64 @mn_map_(new|set|get|size)\b/,
  },
];

describe.skipIf(clang === null || llvmDis === null)("interp <-> native oracle (Phase 2 slice 2D/2H)", () => {
  for (const { name, entry, expectExit, expectDis, expectStdout } of fixtures) {
    test(name, async () => {
      // Interpreter side of the protocol.
      const interp = interpret(entry);
      if (expectStdout === undefined) {
        expect(interp.stdout).toBe("");
      } else {
        expect(interp.stdout).toBe(expectStdout);
      }

      // Native side: emit -> llvm-dis (content check) -> clang(+runtime) -> run.
      const dir = await mkdtempP(join(tmpdir(), "menard-oracle-"));
      const bcPath = join(dir, "out.bc");
      const binPath = join(dir, "out");
      try {
        const emitted = emit(entry, bcPath);
        expect(emitted.stderr).toBe("");
        expect(emitted.exitCode).toBe(0);

        // The slice 2H invariant: the emitted module must *compute* its
        // result, not merely `ret` a folded constant — assert on the
        // disassembled text directly rather than trusting the exit code
        // alone (a still-broken constant-folder could produce the right
        // number for the wrong reason).
        const dis = spawnSync(llvmDis!, [bcPath, "-o", "-"], { encoding: "utf-8" });
        expect(dis.status).toBe(0);
        expect(dis.stdout).toMatch(expectDis);

        // Not asserted on link.stderr: clang warns
        // (`-Woverride-module`) that the emitted `.bc`'s module has no
        // target triple of its own — expected, since `src/emit/bc-writer.mnd`
        // does not set one (see that module's header comment), and
        // harmless (clang just adopts its own default triple instead).
        const link = spawnSync(
          clang!,
          [bcPath, ...RUNTIME_LIB_SRCS, "-I", RUNTIME_INCLUDE, "-o", binPath],
          { encoding: "utf-8" },
        );
        expect(link.status).toBe(0);

        const ran = spawnSync(binPath, [], { encoding: "utf-8" });

        // The oracle invariant slice 2D adds: interp and native must
        // agree with *each other*, independently of the hardcoded
        // `expectExit`/`expectStdout` below — this is what would
        // actually catch drift between `src/emit/lower.mnd`'s real
        // instruction selector and the interpreter's own semantics
        // (arithmetic, and — this slice — `println`/`print`/`write`'s
        // byte-for-byte fd-1 output).
        expect(ran.stdout).toBe(interp.stdout);
        expect(ran.status).toBe(interp.exitCode);

        // Sanity anchor: confirm the shared expectation itself hasn't
        // drifted from what the fixture's header comment claims.
        expect(ran.status).toBe(expectExit);
        expect(interp.exitCode).toBe(expectExit);
        if (expectStdout !== undefined) {
          expect(ran.stdout).toBe(expectStdout);
        }
      } finally {
        await rm(bcPath).catch(() => {});
        await rm(binPath).catch(() => {});
      }
    });
  }

  test("emit fails cleanly (no bitcode written, exit 1) when `main` is missing", async () => {
    const dir = await mkdtempP(join(tmpdir(), "menard-oracle-"));
    const bcPath = join(dir, "out.bc");
    try {
      const emitted = emit("tests/corpus/spec-examples.mnd", bcPath);
      expect(emitted.exitCode).toBe(1);
      expect(emitted.stderr).toContain("main");
    } finally {
      await rm(bcPath).catch(() => {});
    }
  });
});
