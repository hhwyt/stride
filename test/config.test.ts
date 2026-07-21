// F009/F010 — config defaults + validation; stack detection.
import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cleanup, readJson, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

describe("F009 config", () => {
  it("fills defaults from an empty stride.json", () => {
    const dir = tmpProject({ features: "# functional: a\n- x\nverify: t\n" });
    dirs.push(dir);
    writeFileSync(join(dir, "stride.json"), "{}");
    // init loads+validates the merged config; defaults supply a valid executor.command
    expect(runCli(["init"], dir).code).toBe(0);
  });

  it("errors clearly when executor.command lacks {model}", () => {
    const dir = tmpProject({ features: "# functional: a\n- x\nverify: t\n" });
    dirs.push(dir);
    writeFileSync(
      join(dir, "stride.json"),
      JSON.stringify({ executor: { command: "claude -p", prompt_via: "stdin" } }),
    );
    const r = runCli(["next"], dir);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/\{model\}/);
  });
});

describe("F010 stack detection", () => {
  it("writes node defaults for a package.json project", () => {
    const dir = tmpProject({ features: "# functional: a\n- x\nverify: t\n" });
    dirs.push(dir);
    rmSync(join(dir, "stride.json"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    runCli(["init"], dir);
    const cfg = readJson<any>(join(dir, "stride.json"));
    expect(cfg.commands.test).toMatch(/npm/);
  });

  it("writes python defaults for a pyproject.toml project", () => {
    const dir = tmpProject({ features: "# functional: a\n- x\nverify: t\n" });
    dirs.push(dir);
    rmSync(join(dir, "stride.json"));
    writeFileSync(join(dir, "pyproject.toml"), "[project]\nname='x'\n");
    runCli(["init"], dir);
    const cfg = readJson<any>(join(dir, "stride.json"));
    expect(cfg.commands.test).toMatch(/pytest/);
  });
});
