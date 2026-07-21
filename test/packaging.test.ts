// F038 — packaging: bin wired, dist runs, install.sh dry-run, example graph.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CLI, REPO, cleanup, readJson, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

describe("F038 packaging", () => {
  it("wires the bin and the dist entry prints the version", () => {
    expect(existsSync(CLI)).toBe(true);
    const pkg = readJson<any>(join(REPO, "package.json"));
    expect(pkg.bin.stride).toBe("dist/cli.js");
    const v = execFileSync("node", [CLI, "--version"], { encoding: "utf8" }).trim();
    expect(v).toBe(pkg.version);
  });

  it("install.sh --dry-run reports the skill target", () => {
    const out = execFileSync("bash", [join(REPO, "install.sh"), "--dry-run"], { encoding: "utf8" });
    expect(out).toMatch(/\.claude\/skills\/stride/);
  });

  it("the example features.md generates a valid feature graph", () => {
    const example = readFileSync(join(REPO, "examples", "todo-api", "features.md"), "utf8");
    const dir = tmpProject({ features: example });
    dirs.push(dir);
    runCli(["init"], dir);
    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl.length).toBeGreaterThanOrEqual(4);
    expect(runCli(["check"], dir).code).toBe(0);
  });
});
