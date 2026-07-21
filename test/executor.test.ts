// F012/F013 — model routing by complexity tier; single-task prompt assembly.
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { cleanup, readText, runCli, sh, taskStub, tmpProject, writeFeatureList } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

describe("F012/F013 executor", () => {
  it("routes model by complexity and assembles a single-task prompt", () => {
    const dir = tmpProject();
    dirs.push(dir);
    writeFeatureList(dir, [
      taskStub("F001", { complexity: 2, description: "cheap task" }),
      taskStub("F002", { complexity: 9, description: "hard task" }),
    ]);
    sh("git add -A && git commit -q -m base", dir);

    const r = runCli(["run"], dir);
    expect(r.code).toBe(0);

    // F012: complexity 2 -> fast tier, complexity 9 -> capable tier
    expect(readText(join(dir, "models", "F001.txt"))).toBe("m-fast");
    expect(readText(join(dir, "models", "F002.txt"))).toBe("m-capable");

    // F013: the prompt carries the description, verify, and the single-task constraint
    const prompt = readText(join(dir, "prompts", "F001.txt"));
    expect(prompt).toContain("cheap task");
    expect(prompt).toContain("integration test asserts it");
    expect(prompt).toMatch(/EXACTLY ONE task/i);
  });
});
