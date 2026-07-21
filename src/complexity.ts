/** Complexity scoring (1-10) + task expansion. LLM path with a deterministic fallback. */
import { p } from "./paths.js";
import { Config } from "./config.js";
import { Task, loadFeatures, saveFeatures, byId, normalizeTask } from "./model.js";
import { runExecutor } from "./executor.js";

export function heuristicComplexity(t: Task): number {
  const raw = 2 + t.steps.length + t.depends_on.length;
  return Math.max(1, Math.min(10, raw));
}

/** Score every task without a complexity yet. `llm=false` uses the heuristic only. */
export async function analyze(
  root: string,
  cfg: Config,
  opts: { llm: boolean } = { llm: false },
): Promise<Task[]> {
  const tasks = loadFeatures(p.featureList(root));
  for (const t of tasks) {
    if (t.complexity != null) continue;
    if (opts.llm) {
      try {
        const r = await runExecutor(
          cfg,
          root,
          root,
          t,
          `Rate the implementation complexity of this task from 1 to 10. Reply with just the number.\n${t.description}`,
          "evaluate",
        );
        const m = r.stdout.match(/([1-9]|10)/);
        t.complexity = m ? Number(m[1]) : heuristicComplexity(t);
        continue;
      } catch {
        /* fall through to heuristic */
      }
    }
    t.complexity = heuristicComplexity(t);
  }
  saveFeatures(tasks, p.featureList(root));
  return tasks;
}

/** Break a task into subtasks (one per step) that the parent depends on. */
export function expand(root: string, id: string): Task[] {
  const tasks = loadFeatures(p.featureList(root));
  const parent = byId(tasks, id);
  if (!parent) throw new Error(`no such task: ${id}`);
  const steps = parent.steps.length ? parent.steps : [parent.description];
  const subs: Task[] = steps.map((s, i) =>
    normalizeTask({
      id: `${id}.${i + 1}`,
      category: parent.category,
      description: `${parent.description} — ${s}`,
      steps: [s],
      verify: parent.verify,
      priority: parent.priority,
      depends_on: [...parent.depends_on],
    }),
  );
  parent.depends_on = [...parent.depends_on, ...subs.map((s) => s.id)];
  const idx = tasks.findIndex((t) => t.id === id);
  tasks.splice(idx, 0, ...subs);
  saveFeatures(tasks, p.featureList(root));
  return tasks;
}
