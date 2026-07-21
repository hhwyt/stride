// F011 — init scaffolds state, gitignores runtime, commits once, and is idempotent.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, runCli, sh, tmpProject } from "./helpers.js";
import { execFileSync } from "node:child_process";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

function commitCount(dir: string): number {
  const out = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir, encoding: "utf8" });
  return Number(out.trim());
}

describe("F011 init", () => {
  it("scaffolds files, gitignores .stride, commits once, and is idempotent", () => {
    const dir = tmpProject({ features: "# functional: a\n- x\nverify: integration test asserts a\n" });
    dirs.push(dir);

    const r = runCli(["init"], dir);
    expect(r.code).toBe(0);
    for (const f of ["feature_list.json", "TASKS.md", "claude-progress.txt", "AGENT_PROMPT.md"]) {
      expect(existsSync(join(dir, f))).toBe(true);
    }
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(".stride/");
    expect(commitCount(dir)).toBe(1);

    // idempotent: re-running adds no commit and does not error
    const again = runCli(["init"], dir);
    expect(again.code).toBe(0);
    expect(commitCount(dir)).toBe(1);
  });
});
