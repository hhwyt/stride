// F019/F020 — concurrent pipeline with worktree isolation and serial integrate.
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { cleanup, readJson, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

function features(n: number): string {
  let s = "";
  for (let i = 1; i <= n; i++) {
    s += `# functional: feature ${i}\n- build ${i}\nverify: integration test asserts ${i}\n\n`;
  }
  return s;
}

describe("F019/F020 concurrent pipeline", () => {
  it(
    "lands independent tasks in parallel worktrees and integrates cleanly",
    async () => {
      const dir = tmpProject({ features: features(6) });
      dirs.push(dir);
      runCli(["init"], dir);

      const r = runCli(["run", "-j", "3"], dir);
      expect(r.code).toBe(0);

      const fl = readJson<any[]>(join(dir, "feature_list.json"));
      expect(fl).toHaveLength(6);
      expect(fl.every((t) => t.passes)).toBe(true);
      // no duplicate/dropped ids
      expect(new Set(fl.map((t) => t.id)).size).toBe(6);

      // 6 feature commits landed
      const log = execFileSync("git", ["log", "--pretty=%s"], { cwd: dir, encoding: "utf8" });
      expect(log.match(/feat\(F00\d\)/g)?.length).toBe(6);

      // F019 cleanup: no leftover worktrees or stride/* branches
      const worktrees = execFileSync("git", ["worktree", "list"], { cwd: dir, encoding: "utf8" });
      expect(worktrees.trim().split("\n")).toHaveLength(1);
      const branches = execFileSync("git", ["branch", "--list", "stride/*"], { cwd: dir, encoding: "utf8" });
      expect(branches.trim()).toBe("");
    },
    30000,
  );
});
