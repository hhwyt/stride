/**
 * Verification gates. The exit-code gate is mechanical and unfakable: a task is
 * never "done" unless its test command exits 0, whatever the agent claims.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Config } from "./config.js";
import { Task, Reachability } from "./model.js";
import { p } from "./paths.js";
import { runSync } from "./util.js";
import { git } from "./git.js";
import { buildPrompt, runExecutor } from "./executor.js";

export interface Evidence {
  code: number;
  path: string;
}

/** Run the test command; capture stdout/stderr + "Exit status: N" to evidence. */
export function runTestGate(
  cfg: Config,
  cwd: string,
  root: string,
  task: Task,
): Evidence {
  const env = { ...process.env, STRIDE_TASK_ID: task.id, STRIDE_ROOT: root };
  const r = runSync(cfg.commands.test || "true", { cwd, env });
  mkdirSync(p.evidenceDir(root), { recursive: true });
  const evPath = join(p.evidenceDir(root), `${task.id}.log`);
  writeFileSync(
    evPath,
    `$ ${cfg.commands.test}\n${r.stdout}\n${r.stderr}\nExit status: ${r.code}\n`,
  );
  return { code: r.code, path: evPath };
}

/** Regression smoke: existing features must still work. */
export function smokeGate(cfg: Config, cwd: string): boolean {
  if (!cfg.commands.smoke) return true;
  return runSync(cfg.commands.smoke, { cwd }).code === 0;
}

/** Optional LLM evaluator. Returns pass=true when disabled. */
export async function evaluatorGate(
  cfg: Config,
  cwd: string,
  root: string,
  task: Task,
): Promise<{ pass: boolean; reason: string }> {
  if (!cfg.run.evaluator) return { pass: true, reason: "evaluator disabled" };
  const diff = runSync("git diff --cached", { cwd }).stdout.slice(0, 6000);
  const prompt = buildPrompt(task, "evaluate", diff);
  const r = await runExecutor(cfg, cwd, root, task, prompt, "evaluate");
  const first = (r.stdout.trim().split("\n")[0] ?? "").trim();
  if (first.toUpperCase().startsWith("PASS")) return { pass: true, reason: "PASS" };
  return { pass: false, reason: first || "NEEDS_WORK" };
}

/**
 * Reachability sweep: a source module added by this task that nothing else
 * references is scaffolding, not "done". Heuristic by basename grep.
 */
export function reachabilityGate(
  cfg: Config,
  cwd: string,
  startSha: string,
): Reachability {
  if (!cfg.run.reachability) return null;
  const changed = git(`diff --name-only ${startSha}..HEAD`, cwd)
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  const added = changed.filter((f) => /\.(ts|tsx|js|jsx|py|rs|go|java)$/.test(f));
  if (added.length === 0) return "EXEMPT";
  for (const f of added) {
    const base = (f.split("/").pop() ?? "").replace(/\.\w+$/, "");
    if (!base) continue;
    const grep = runSync(`git grep -l -F ${JSON.stringify(base)} || true`, { cwd });
    const hits = grep.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((h) => h !== f);
    if (hits.length > 0) return "WIRED";
  }
  return "ORPHAN";
}
