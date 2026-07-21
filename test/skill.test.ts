// F035 — the skill has valid front-matter and references real stride commands.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./helpers.js";

describe("F035 skill wrapper", () => {
  it("declares name/description and points at real commands", () => {
    const md = readFileSync(join(REPO, "skill", "SKILL.md"), "utf8");
    const fm = md.match(/^---\n([\s\S]*?)\n---/);
    expect(fm).not.toBeNull();
    expect(fm![1]).toMatch(/name:\s*stride/);
    expect(fm![1]).toMatch(/description:\s*\S+/);
    expect(md).toContain("stride init");
    expect(md).toContain("stride run");
    expect(md).toContain("stride status");
  });
});
