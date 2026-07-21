// T0 — the mock executor + test harness must let us drive the real CLI offline.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cleanup, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

describe("T0 harness", () => {
  it("runs the real CLI against an isolated project", () => {
    const dir = tmpProject({ features: "# functional: a\n- x\nverify: t\n" });
    dirs.push(dir);
    const v = runCli(["--version"], dir);
    expect(v.code).toBe(0);
    expect(v.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);

    runCli(["init"], dir);
    expect(existsSync(join(dir, "feature_list.json"))).toBe(true);
    const s = runCli(["status"], dir);
    expect(s.code).toBe(0);
    expect(s.stdout).toContain("progress:");
  });
});
