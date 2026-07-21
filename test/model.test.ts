// F001 — feature_list.json load/save preserves unknown fields; mutations are targeted.
import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, readJson, runCli, sh, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

function task(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    category: "functional",
    description: `desc ${id}`,
    steps: [],
    verify: "t",
    depends_on: [],
    priority: "medium",
    complexity: null,
    status: "pending",
    passes: false,
    attempts: 0,
    evidence: null,
    reachability: null,
    ...extra,
  };
}

describe("F001 model round-trip", () => {
  it("preserves unknown fields and mutates only the landed task", () => {
    const dir = tmpProject();
    dirs.push(dir);
    writeFileSync(
      join(dir, "feature_list.json"),
      JSON.stringify([task("F001", { note: "keep-me" }), task("F002")], null, 2) + "\n",
    );
    sh("git add -A && git commit -q -m base", dir);

    const r = runCli(["run", "--once"], dir);
    expect(r.code).toBe(0);

    const fl = readJson<any[]>(join(dir, "feature_list.json"));
    const f1 = fl.find((t) => t.id === "F001");
    const f2 = fl.find((t) => t.id === "F002");
    expect(f1.passes).toBe(true);
    expect(f1.note).toBe("keep-me"); // unknown field survived load->mutate->save
    expect(f2.passes).toBe(false); // untouched
    expect(f2.status).toBe("pending");
  });
});
