// F028/F029 — complexity scoring + task expansion.
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { cleanup, readJson, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

const F = `# functional: a
- s1
- s2
verify: integration test asserts a

# functional: b
- s1
verify: integration test asserts b
deps: F001
`;

describe("F028 analyze", () => {
  it("scores every task in 1-10 (heuristic)", () => {
    const dir = tmpProject({ features: F });
    dirs.push(dir);
    runCli(["init"], dir);
    expect(runCli(["analyze"], dir).code).toBe(0);
    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    for (const t of fl) {
      expect(t.complexity).toBeGreaterThanOrEqual(1);
      expect(t.complexity).toBeLessThanOrEqual(10);
    }
  });
});

describe("F029 expand", () => {
  it("breaks a task into subtasks without creating a cycle", () => {
    const dir = tmpProject({ features: F });
    dirs.push(dir);
    runCli(["init"], dir);
    expect(runCli(["expand", "F001"], dir).code).toBe(0);

    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    const subs = fl.filter((t) => t.id.startsWith("F001."));
    expect(subs.length).toBeGreaterThanOrEqual(1);
    const parent = fl.find((t) => t.id === "F001");
    for (const s of subs) expect(parent.depends_on).toContain(s.id);

    expect(runCli(["check"], dir).code).toBe(0); // graph still valid
  });
});
