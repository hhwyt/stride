// F014/F015/F017 — exit-code gate, regression smoke, reachability sweep.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { cleanup, readJson, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

function commitCount(dir: string): number {
  return Number(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir, encoding: "utf8" }).trim());
}
const ONE = "# functional: only feature\n- do it\nverify: integration test asserts it\n";
const TWO = ONE + "\n# functional: second feature\n- do it too\nverify: integration test asserts it too\n";

describe("F014 exit-code gate", () => {
  it("never marks a task passed when its test exits non-zero", () => {
    const dir = tmpProject({ features: ONE });
    dirs.push(dir);
    runCli(["init"], dir);
    const before = commitCount(dir);

    const r = runCli(["run", "--once"], dir, { STRIDE_MOCK_FAIL_IDS: "F001" });
    expect(r.code).toBe(0);

    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl[0].passes).toBe(false);
    expect(fl[0].status).toBe("needs-work");
    expect(readFileSync(join(dir, ".stride", "evidence", "F001.log"), "utf8")).toContain("Exit status: 1");
    expect(commitCount(dir)).toBe(before); // no feature commit
  });
});

describe("F015 regression smoke", () => {
  it("halts before starting a task when smoke is failing", () => {
    const dir = tmpProject({ features: TWO });
    dirs.push(dir);
    runCli(["init"], dir);
    runCli(["run", "--once"], dir); // lands F001
    const after = commitCount(dir);

    writeFileSync(join(dir, "BREAK_SMOKE"), "x"); // simulate a broken existing feature
    const r = runCli(["run"], dir);
    expect(r.stdout).toMatch(/regression/i);

    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl.find((t) => t.id === "F002").passes).toBe(false);
    expect(commitCount(dir)).toBe(after); // base unchanged
  });
});

describe("F017 reachability sweep", () => {
  it("records ORPHAN for an unreferenced module; blocks to scaffold when configured", () => {
    const dir = tmpProject({ features: ONE });
    dirs.push(dir);
    runCli(["init"], dir);
    runCli(["run", "--once"], dir, { STRIDE_MOCK_ORPHAN_IDS: "F001" });
    let fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl[0].reachability).toBe("ORPHAN");
    expect(fl[0].passes).toBe(true); // default: warn only

    // with blocking on, an orphan downgrades to scaffold (not done)
    const dir2 = tmpProject({ features: ONE, config: { run: { reachability_blocks: true } } });
    dirs.push(dir2);
    runCli(["init"], dir2);
    runCli(["run", "--once"], dir2, { STRIDE_MOCK_ORPHAN_IDS: "F001" });
    fl = readJson<any[]>(join(dir2, "feature_list.json"));
    expect(fl[0].status).toBe("scaffold");
    expect(fl[0].passes).toBe(false);
  });
});
