// F030/F033 — decompose from a prompt; spec grading gate.
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { cleanup, readJson, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

describe("F030 decompose from --prompt", () => {
  it("expands a prompt into features that each carry a verify line", () => {
    const dir = tmpProject(); // no features.md yet
    dirs.push(dir);
    const r = runCli(["init", "--prompt", "build a signup flow"], dir);
    expect(r.code).toBe(0);
    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl.length).toBeGreaterThanOrEqual(1);
    for (const t of fl) expect(t.verify.length).toBeGreaterThan(0);
  });
});

describe("F033 spec grading gate", () => {
  it("blocks input with placeholders and passes clean input", () => {
    const bad = tmpProject({ features: "# functional: a\n- TODO finish this\nverify: t\n" });
    dirs.push(bad);
    const r = runCli(["check"], bad);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/NEEDS_WORK/);

    const good = tmpProject({ features: "# functional: a\n- do it\nverify: t\n" });
    dirs.push(good);
    expect(runCli(["check"], good).code).toBe(0);
  });
});
