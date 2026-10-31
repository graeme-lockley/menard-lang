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

import { extractReviewSection, readState, slug, tail, writeState } from "../../tools/loop/lib.ts";
import { executePrompt, reviewPrompt } from "../../tools/loop/prompts.ts";
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
