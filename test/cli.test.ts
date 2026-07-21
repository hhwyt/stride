// F034 — CLI dispatch: help lists commands; unknown command fails.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

describe("F034 CLI dispatch", () => {
  it("lists every subcommand in --help", () => {
    const dir = tmpProject();
    dirs.push(dir);
    const h = runCli(["--help"], dir);
    expect(h.code).toBe(0);
    for (const c of ["init", "run", "status", "check", "sync", "analyze", "expand", "next", "ready"]) {
      expect(h.stdout).toContain(c);
    }
  });

  it("exits non-zero on an unknown command", () => {
    const dir = tmpProject();
    dirs.push(dir);
    const r = runCli(["bogus"], dir);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/unknown command/);
  });
});
