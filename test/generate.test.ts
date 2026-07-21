// F002/F003/F004 — generate/sync from features.md, preserving passes; TASKS.md mirror.
import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, readJson, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

const FEATURES = `# functional: user can log in
- enter email and password
- click login
verify: integration test asserts redirect to /dashboard
priority: high

# functional: user can log out
- click logout
verify: integration test asserts the session is destroyed
`;

describe("F002/F003/F004 generate + preserve", () => {
  it("assigns ids, writes TASKS.md, and preserves passes across sync", () => {
    const dir = tmpProject({ features: FEATURES });
    dirs.push(dir);
    runCli(["init"], dir);

    let fl = readJson<any[]>(join(dir, "feature_list.json"));
    expect(fl.map((t) => t.id)).toEqual(["F001", "F002"]);
    expect(fl[0].priority).toBe("high");
    expect(fl[0].verify).toContain("redirect");

    // TASKS.md mirror lists every id
    const tasksMd = readFileSync(join(dir, "TASKS.md"), "utf8");
    expect(tasksMd).toContain("F001");
    expect(tasksMd).toContain("F002");

    // mark F002 done, append a 3rd feature, sync -> F002 progress preserved
    fl = readJson<any[]>(join(dir, "feature_list.json"));
    fl[1].passes = true;
    fl[1].status = "done";
    writeFileSync(join(dir, "feature_list.json"), JSON.stringify(fl, null, 2) + "\n");

    appendFileSync(
      join(dir, "features.md"),
      "\n# functional: user can reset password\n- request a reset link\nverify: integration test asserts an email is sent\n",
    );
    const r = runCli(["sync"], dir);
    expect(r.code).toBe(0);

    const after = readJson<any[]>(join(dir, "feature_list.json"));
    expect(after).toHaveLength(3);
    const logout = after.find((t) => t.description === "user can log out");
    const reset = after.find((t) => t.description === "user can reset password");
    expect(logout.passes).toBe(true); // preserved
    expect(reset.passes).toBe(false); // new
  });
});
