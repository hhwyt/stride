// F022/F023 — retry budget + BLOCKED.md escape hatch; kill-switch + steering.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, readJson, readText, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

const ONE = "# functional: only feature\n- do it\nverify: integration test asserts it\n";
const TWO = ONE + "\n# functional: second\n- do it too\nverify: integration test asserts too\n";

describe("F022 retry budget + BLOCKED.md", () => {
  it("blocks a task after the retry budget and does not spin", () => {
    const dir = tmpProject({ features: ONE, config: { run: { retry_budget: 2 } } });
    dirs.push(dir);
    runCli(["init"], dir);
    const r = runCli(["run"], dir, { STRIDE_MOCK_FAIL_IDS: "F001" });
    expect(r.code).toBe(0);

    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl[0].status).toBe("blocked");
    expect(fl[0].attempts).toBe(2); // stopped exactly at budget
    expect(existsSync(join(dir, ".stride", "BLOCKED.md"))).toBe(true);
    expect(readText(join(dir, ".stride", "BLOCKED.md"))).toContain("F001");
  });
});

describe("F023 kill-switch + steering", () => {
  it("AGENT_STOP halts the run before any task", () => {
    const dir = tmpProject({ features: TWO });
    dirs.push(dir);
    runCli(["init"], dir);
    writeFileSync(join(dir, "AGENT_STOP"), "");
    const r = runCli(["run"], dir);
    expect(r.stdout).toMatch(/AGENT_STOP/);
    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl.every((t) => !t.passes)).toBe(true);
  });

  it("STEER.md is folded into the next prompt and cleared", () => {
    const dir = tmpProject({ features: ONE });
    dirs.push(dir);
    runCli(["init"], dir);
    writeFileSync(join(dir, "STEER.md"), "USE_SPECIAL_APPROACH");
    runCli(["run", "--once"], dir);
    expect(readText(join(dir, "steer_F001.txt"))).toContain("USE_SPECIAL_APPROACH");
    expect(readFileSync(join(dir, "STEER.md"), "utf8").trim()).toBe("");
  });
});
