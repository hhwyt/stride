// F039 — the CI workflow must run the suite on push + PR across a Node matrix.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "./helpers.js";

describe("F039 CI config", () => {
  it("runs the suite on push and pull_request across the Node matrix", () => {
    const yml = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");
    expect(yml).toMatch(/^on:/m);
    expect(yml).toContain("push");
    expect(yml).toContain("pull_request");
    expect(yml).toContain("npm test");
    for (const v of ["18", "20", "22"]) expect(yml).toContain(v);
  });
});
