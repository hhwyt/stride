// F005/F006/F007/F008 — cycle detection, ready-set, ordering, validate/fix.
import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, readJson, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

function task(id: string, depends_on: string[] = [], extra: Record<string, unknown> = {}) {
  return {
    id,
    category: "functional",
    description: `d${id}`,
    steps: [],
    verify: "t",
    depends_on,
    priority: "medium",
    complexity: null,
    status: "pending",
    passes: false,
    attempts: 0,
    evidence: null,
    reachability: null,
    ...extra,
  };
}

function writeFL(dir: string, tasks: unknown[]) {
  writeFileSync(join(dir, "feature_list.json"), JSON.stringify(tasks, null, 2) + "\n");
}

describe("F005 cycle detection", () => {
  it("refuses to run and reports the cycle path", () => {
    const dir = tmpProject();
    dirs.push(dir);
    writeFL(dir, [task("F001", ["F002"]), task("F002", ["F001"])]);
    const next = runCli(["next"], dir);
    expect(next.code).toBe(1);
    expect(next.stderr).toMatch(/cycle/i);
    const run = runCli(["run"], dir);
    expect(run.code).toBe(1);
  });
});

describe("F006 ready-set", () => {
  it("only surfaces tasks whose dependencies have passed", () => {
    const dir = tmpProject();
    dirs.push(dir);
    writeFL(dir, [task("F001"), task("F002", ["F001"])]);
    expect(runCli(["ready"], dir).stdout.trim().split("\n")).toEqual(["F001"]);

    writeFL(dir, [task("F001", [], { passes: true, status: "done" }), task("F002", ["F001"])]);
    expect(runCli(["ready"], dir).stdout.trim().split("\n")).toEqual(["F002"]);
  });
});

describe("F007 ordering", () => {
  it("prefers the task that unblocks the most others", () => {
    const dir = tmpProject();
    dirs.push(dir);
    writeFL(dir, [
      task("F001"),
      task("F002"),
      task("F003", ["F002"]),
      task("F004", ["F002"]),
      task("F005", ["F002"]),
    ]);
    const next = runCli(["next"], dir);
    expect(next.code).toBe(0);
    expect(JSON.parse(next.stdout).id).toBe("F002");
  });
});

describe("F008 validate/fix dependencies", () => {
  it("flags a dangling dependency and --fix removes it", () => {
    const dir = tmpProject();
    dirs.push(dir);
    writeFL(dir, [task("F001", ["F999"])]);
    const check = runCli(["check"], dir);
    expect(check.code).toBe(1);
    expect(check.stderr).toMatch(/F999/);

    const fixed = runCli(["check", "--fix"], dir);
    expect(fixed.code).toBe(0);
    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl[0].depends_on).toEqual([]);
  });
});
