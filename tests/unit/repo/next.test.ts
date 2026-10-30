import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildReport, formatReport, parseBacklog } from "../../../tools/next.ts";
import type { Row } from "../../../tools/next.ts";

const root = join(import.meta.dir, "..", "..", "..");

function row(id: string, patch: Partial<Row> = {}): Row {
  return {
    id,
    title: `${id} title`,
    area: "Language",
    priority: "P0",
    phase: 0,
    status: "ready",
    blockers: [],
    issue: "",
    ...patch,
  };
}

describe("backlog next", () => {
  test("parses the real backlog table", () => {
    const rows = parseBacklog(readFileSync(join(root, "docs/backlog.md"), "utf8"));
    expect(rows.length).toBeGreaterThan(50);

    const close = rows.find((r) => r.id === "CONC-01");
    expect(close?.status).toBe("done");
    expect(close?.blockers).toEqual([]);
    expect(close?.issue).toBe("#18");

    const deadlines = rows.find((r) => r.id === "CONC-02");
    expect(deadlines?.status).toBe("done");
    expect(deadlines?.blockers).toEqual(["CONC-01"]);

    const show = rows.find((r) => r.id === "LANG-01");
    expect(show?.blockers).toEqual(["LANG-07", "LANG-02", "LANG-10"]);
    expect(rows.every((r) => Number.isInteger(r.phase))).toBe(true);
  });

  test("starts only fully unblocked rows in the current phase", () => {
    const rows = [
      row("LANG-01"),
      row("LANG-02", { status: "done" }),
      row("LANG-03", { blockers: ["LANG-02"] }),
      row("LANG-04", { blockers: ["LANG-01"], status: "blocked" }),
      row("LIB-01", { phase: 1, status: "todo" }),
      row("CONC-09", { status: "in-progress", blockers: ["LANG-01"] }),
    ];
    const report = buildReport(rows);

    expect(report.currentPhase).toBe(0);
    expect(report.done).toBe(1);
    expect(report.startNow.map((r) => r.id)).toEqual(["LANG-01", "LANG-03"]);
    expect(report.inProgress.map((entry) => [entry.row.id, entry.unmet])).toEqual([
      ["CONC-09", ["LANG-01"]],
    ]);
    expect(report.oneAway.map((entry) => [entry.row.id, entry.blocker])).toEqual([
      ["LANG-04", "LANG-01"],
    ]);
  });

  test("treats wontfix as satisfied and todo as startable", () => {
    const rows = [
      row("OTH-01", { status: "todo" }),
      row("OTH-02", { status: "wontfix" }),
      row("OTH-03", { blockers: ["OTH-02"] }),
    ];
    expect(buildReport(rows).startNow.map((r) => r.id)).toEqual(["OTH-01", "OTH-03"]);
  });

  test("reports a cycle instead of pretending its members can start", () => {
    const rows = [
      row("LANG-03", { blockers: ["LIB-01"] }),
      row("LIB-01", { blockers: ["LANG-03"], phase: 2 }),
      row("LIB-06", { blockers: ["LANG-03"] }),
    ];
    const report = buildReport(rows);

    expect(report.cycles).toEqual([["LANG-03", "LIB-01"]]);
    expect(report.startNow).toEqual([]);
    // LIB-06 has one blocker left, but that blocker is in the cycle, so it is
    // not one step from starting; the cycle section carries that information.
    expect(report.oneAway).toEqual([]);
  });

  test("--all ignores the phase gate", () => {
    const rows = [row("LANG-01"), row("TOOL-02", { phase: 1, status: "todo" })];
    expect(buildReport(rows).startNow.map((r) => r.id)).toEqual(["LANG-01"]);
    expect(buildReport(rows, { allPhases: true }).startNow.map((r) => r.id)).toEqual([
      "LANG-01",
      "TOOL-02",
    ]);
  });

  test("formats sections without colour codes when colour is off", () => {
    const rows = [row("CONC-01"), row("CONC-02", { blockers: ["CONC-01"] })];
    const text = formatReport(buildReport(rows));

    expect(text).toContain("Menard backlog — phase 0");
    expect(text).toContain("Start now");
    expect(text).toContain("CONC-01");
    expect(text).toContain("One blocker away");
    expect(text).toContain("after CONC-01");
    expect(text).not.toContain("\x1b");
  });

  test("says so when everything is done", () => {
    const rows = [row("CONC-01", { status: "done" })];
    const report = buildReport(rows);
    expect(report.currentPhase).toBeNull();
    expect(formatReport(report)).toContain("Backlog complete");
  });
});
