// F018/F024/F025/F026/F027 — sequential run, caps, execute-log, cost ledger, status.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { cleanup, readJson, runCli, tmpProject, writeFeatureList } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

const CHAIN = `# functional: base
- do base
verify: integration test asserts base

# functional: middle
- do middle
verify: integration test asserts middle
deps: F001

# functional: top
- do top
verify: integration test asserts top
deps: F002
`;

const THREE_INDEP = `# functional: a
- x
verify: t a

# functional: b
- x
verify: t b

# functional: c
- x
verify: t c
`;

function logLines(dir: string): any[] {
  return readFileSync(join(dir, ".stride", "execute-log.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("F018 sequential run", () => {
  it("lands every task in dependency order as clean commits", () => {
    const dir = tmpProject({ features: CHAIN });
    dirs.push(dir);
    runCli(["init"], dir);
    const r = runCli(["run"], dir);
    expect(r.code).toBe(0);

    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl.every((t) => t.passes)).toBe(true);

    const log = execFileSync("git", ["log", "--pretty=%s"], { cwd: dir, encoding: "utf8" });
    expect(log.match(/feat\(F00\d\)/g)?.length).toBe(3);

    // F025: one execute-log row per landed task with typed fields
    const rows = logLines(dir);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(typeof row.task_id).toBe("string");
      expect(typeof row.outcome).toBe("string");
      expect(["fast", "standard", "capable"]).toContain(row.tier);
    }

    // F026 + F027: cost recorded, status prints a total
    const s = runCli(["status"], dir);
    expect(s.stdout).toContain("3/3");
    expect(s.stdout).toMatch(/cost: \$\d/);
  });
});

describe("F024 caps", () => {
  it("stops after max-iterations", () => {
    const dir = tmpProject({ features: THREE_INDEP });
    dirs.push(dir);
    runCli(["init"], dir);
    const r = runCli(["run", "--max-iterations", "1"], dir);
    expect(r.stdout).toMatch(/max_iterations/);
    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl.filter((t) => t.passes).length).toBe(1);
  });
});

describe("F027 status", () => {
  it("reports done count, blocked ids, and cost", () => {
    const dir = tmpProject();
    dirs.push(dir);
    // hand-authored mixed state
    const tasks = [
      { id: "F001", category: "functional", description: "a", steps: [], verify: "t", depends_on: [], priority: "medium", complexity: null, status: "done", passes: true, attempts: 1, evidence: null, reachability: null },
      { id: "F002", category: "functional", description: "b", steps: [], verify: "t", depends_on: [], priority: "medium", complexity: null, status: "blocked", passes: false, attempts: 3, evidence: null, reachability: null },
    ];
    writeFeatureList(dir, tasks);
    const s = runCli(["status"], dir);
    expect(s.stdout).toContain("1/2");
    expect(s.stdout).toMatch(/blocked: F002/);
  });
});
