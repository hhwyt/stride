// Regression tests for review findings: crash recovery, empty-test gate,
// id validation (shell-safety), and numeric-arg validation.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, readJson, runCli, taskStub, tmpProject, writeFeatureList } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

const ONE = "# functional: only feature\n- do it\nverify: integration test asserts it\n";

describe("recovery after interruption (AGENT_STOP / crash)", () => {
  it("reconciles an in-progress task + stale lock and completes", () => {
    const dir = tmpProject({ features: ONE });
    dirs.push(dir);
    runCli(["init"], dir);

    // simulate a task interrupted mid-flight: in-progress + a held lock
    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    fl[0].status = "in-progress";
    writeFeatureList(dir, fl);
    mkdirSync(join(dir, ".stride", "locks"), { recursive: true });
    writeFileSync(join(dir, ".stride", "locks", "F001"), "");

    const r = runCli(["run"], dir);
    expect(r.code).toBe(0);
    const after = readJson<any[]>(join(dir, "feature_list.json"));
    expect(after[0].passes).toBe(true);
    expect(existsSync(join(dir, ".stride", "locks", "F001"))).toBe(false);
  });
});

describe("empty test command cannot pass the gate", () => {
  it("fails a task when commands.test is empty", () => {
    const dir = tmpProject({ features: ONE, config: { commands: { test: "" } } });
    dirs.push(dir);
    runCli(["init"], dir);
    const r = runCli(["run", "--once"], dir);
    expect(r.code).toBe(0);
    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl[0].passes).toBe(false);
    expect(fl[0].status).toBe("needs-work");
  });
});

describe("task id validation (shell safety)", () => {
  it("rejects an id with shell-unsafe characters", () => {
    const dir = tmpProject();
    dirs.push(dir);
    writeFeatureList(dir, [taskStub("bad id;$(touch pwned)")]);
    const r = runCli(["check"], dir);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/invalid task id/);
  });
});

describe("agent self-commit is not a failure", () => {
  it("lands a task even when the agent committed its own work", () => {
    const dir = tmpProject({ features: ONE });
    dirs.push(dir);
    runCli(["init"], dir);
    const r = runCli(["run", "--once"], dir, { STRIDE_MOCK_SELFCOMMIT: "1" });
    expect(r.code).toBe(0);
    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl[0].passes).toBe(true);
    expect(fl[0].status).toBe("done");
  });
});

describe("executor timeout", () => {
  it("kills a hung executor instead of freezing the run", () => {
    const dir = tmpProject({
      features: ONE,
      config: { executor: { timeout_seconds: 1 }, run: { retry_budget: 1 } },
    });
    dirs.push(dir);
    runCli(["init"], dir);
    const start = Date.now();
    const r = runCli(["run", "--once"], dir, { STRIDE_MOCK_SLEEP: "10" });
    expect(r.code).toBe(0);
    expect(Date.now() - start).toBeLessThan(9000); // did not wait the full 10s sleep
    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl[0].passes).toBe(false);
  });
});

describe("numeric argument validation", () => {
  it("rejects a non-numeric -j instead of silently doing nothing", () => {
    const dir = tmpProject({ features: ONE });
    dirs.push(dir);
    runCli(["init"], dir);
    const r = runCli(["run", "-j", "abc"], dir);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/invalid -j/);
  });
});
