// F037 — the headless loop drives stride until the build completes.
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CLI, REPO, cleanup, readJson, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

describe("F037 long-run.sh", () => {
  it(
    "loops stride in fresh processes until every feature lands",
    () => {
      const dir = tmpProject({
        features: "# functional: a\n- x\nverify: t a\n\n# functional: b\n- x\nverify: t b\n",
      });
      dirs.push(dir);
      runCli(["init"], dir);

      const out = execFileSync("bash", [join(REPO, "scripts", "long-run.sh"), dir], {
        encoding: "utf8",
        env: { ...process.env, STRIDE_BIN: `node ${CLI}` },
      });
      expect(out).toMatch(/complete/);

      const fl = readJson<any[]>(join(dir, "feature_list.json"));
      expect(fl.every((t) => t.passes)).toBe(true);
    },
    20000,
  );
});
