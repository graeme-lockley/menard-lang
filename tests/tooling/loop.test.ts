/**
 * The loop driver's parsing is the part that fails quietly: a review section
 * that stops at the wrong heading, a branch slug that mangles an apostrophe,
 * a state file that resumes the wrong item. These are the cheap checks for it.
 *
 * The driver's process behaviour is not tested here — that needs a repository
 * and a Cursor session. `make loop ARGS=--dry-run` is the manual check.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractReviewSection, readState, runStreaming, slug, tail, writeState } from "../../tools/loop/lib.ts";
import { executePrompt, reviewPrompt } from "../../tools/loop/prompts.ts";
import { renderCursorEvent } from "../../tools/loop/run.ts";
import type { Row } from "../../tools/next.ts";

const REVIEW = join(import.meta.dir, "..", "..", "docs", "reviews", "2026-10-24-build-f.md");

const row: Row = {
  id: "CONC-05",
  title: "An actor's death must not hang its callers",
  area: "Concurrency",
  priority: "P0",
  phase: 0,
  status: "ready",
  blockers: ["CONC-01", "CONC-02"],
  issue: "22",
};

describe("extractReviewSection", () => {
  const markdown = readFileSync(REVIEW, "utf8");

  test("returns the item's own section and nothing after it", () => {
    const section = extractReviewSection(markdown, "CONC-05");
    expect(section).not.toBeNull();
    expect(section ?? "").toMatch(/^### CONC-05/);
    expect(section).toContain("**Acceptance criteria.**");
    expect(section).toContain("Actor.call");
    expect(section).not.toContain("CONC-06");
    expect(section).not.toContain("Harden supervision");
  });

  test("stops before the next item, including its anchor", () => {
    const section = extractReviewSection(markdown, "LANG-01");
    expect(section).not.toBeNull();
    expect(section).toContain("LANG-01");
    expect(section).not.toContain('<a id="lang-02"');
  });

  test("returns null for an id that is not in the review", () => {
    expect(extractReviewSection(markdown, "NOPE-01")).toBeNull();
  });
});

describe("slug", () => {
  test("keeps apostrophes out of branch names", () => {
    expect(slug("An actor's death must not hang its callers", 6)).toBe("an-actors-death-must-not-hang");
  });

  test("strips backticks and punctuation, and respects the word limit", () => {
    expect(slug("`show` must be human-readable, and correct", 4)).toBe("show-must-be-human-readable");
  });
});

describe("tail", () => {
  test("keeps the end of a long failure log", () => {
    const log = `${"noise\n".repeat(1000)}panic: the actual cause\n`;
    const kept = tail(log, 100);
    expect(kept).toContain("panic: the actual cause");
    expect(kept.length).toBeLessThan(log.length);
  });

  test("leaves a short log alone", () => {
    expect(tail("ok\n", 100)).toBe("ok");
  });
});

describe("state", () => {
  test("round-trips the run state", () => {
    const dir = mkdtempSync(join(tmpdir(), "menard-loop-"));
    try {
      const path = join(dir, "state.json");
      const state = {
        item: "CONC-05",
        branch: "fix/conc-05-an-actors-death",
        base: "main",
        phase: "gate",
        rounds: 1,
        startedAt: "2026-10-31T00:00:00.000Z",
      };
      writeState(path, state);
      expect(readState(path)).toEqual(state);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns null rather than resuming a malformed file", () => {
    const dir = mkdtempSync(join(tmpdir(), "menard-loop-"));
    try {
      const path = join(dir, "state.json");
      writeFileSync(path, '{"item":"CONC-05"}');
      expect(readState(path)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("renderCursorEvent", () => {
  test("renders the system, assistant, tool-call and result events", () => {
    const trace = { result: null as string | null, text: "" };
    const out: string[] = [];
    const log = { log: (message: string) => out.push(message) };
    renderCursorEvent(JSON.stringify({ type: "system", subtype: "init", model: "Auto" }), log, trace);
    renderCursorEvent(
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Reading the actor." }] } }),
      log,
      trace,
    );
    renderCursorEvent(
      JSON.stringify({ type: "tool_call", subtype: "started", tool_call: { tool: { case: "shellToolCall", value: { args: { command: "make ci" } } } } }),
      log,
      trace,
    );
    renderCursorEvent(JSON.stringify({ type: "result", subtype: "success", duration_ms: 4200, result: "the plan" }), log, trace);

    expect(out[0]).toContain("Auto");
    expect(out[1]).toContain("Reading the actor.");
    expect(out[2]).toContain("shellToolCall");
    expect(out[2]).toContain("make ci");
    expect(out[3]).toContain("success");
    expect(trace.text).toContain("Reading the actor.");
    expect(trace.result).toBe("the plan");
  });

  test("passes non-JSON lines through and ignores thinking", () => {
    const out: string[] = [];
    const log = { log: (message: string) => out.push(message) };
    const trace = { result: null as string | null, text: "" };
    renderCursorEvent("warning: something", log, trace);
    renderCursorEvent(JSON.stringify({ type: "thinking", subtype: "delta", text: "hmm" }), log, trace);
    expect(out).toEqual(["warning: something"]);
    expect(trace.text).toBe("");
  });
});

describe("runStreaming", () => {
  test("streams stdout line by line, keeps stderr, and returns the exit code", async () => {
    const lines: string[] = [];
    const result = await runStreaming(
      process.execPath,
      ["-e", "console.log('one'); console.log('two'); console.error('oops'); process.exit(3)"],
      { onLine: (line) => lines.push(line) },
    );
    expect(lines).toEqual(["one", "two"]);
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("oops");
  });

  test("kills a command that overruns its timeout", async () => {
    const result = await runStreaming(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 300 });
    expect(result.timedOut).toBe(true);
  });
});

describe("prompt contracts", () => {
  test("the implement prompt carries the plan and forbids committing", () => {
    const prompt = executePrompt({ row, plan: "## Scope\nactor.mnd", reviewFile: "docs/reviews/x.md" });
    expect(prompt).toContain("## Scope");
    expect(prompt).toContain("Do not commit");
    expect(prompt).toContain("docs/reviews/x.md#conc-05");
  });

  test("the review prompt demands the JSON verdict and no edits", () => {
    const prompt = reviewPrompt({
      row,
      specification: "### CONC-05\n- [ ] a criterion",
      base: "main",
      status: " M stdlib/actor.mnd",
      stat: "1 file changed",
    });
    expect(prompt).toContain('"satisfied"');
    expect(prompt).toContain("Output JSON only");
    expect(prompt).toContain("a criterion");
    expect(prompt).toContain("Do not modify files");
  });
});
