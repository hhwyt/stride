/** The dependency DAG: cycle detection, validation, ready-set, ordering. */
import { Task, PRIORITY_RANK } from "./model.js";
import { Config } from "./config.js";

export function findCycle(tasks: Task[]): string[] | null {
  const ids = new Set(tasks.map((t) => t.id));
  const adj = new Map<string, string[]>(
    tasks.map((t) => [t.id, t.depends_on.filter((d) => ids.has(d))]),
  );
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  let cycle: string[] | null = null;

  function dfs(u: string): boolean {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) {
        const i = stack.indexOf(v);
        cycle = stack.slice(i).concat(v);
        return true;
      }
      if (c === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    stack.pop();
    return false;
  }

  for (const t of tasks) {
    if ((color.get(t.id) ?? WHITE) === WHITE && dfs(t.id)) return cycle;
  }
  return null;
}

const ID_RE = /^[A-Za-z0-9._-]+$/;

export function validate(tasks: Task[]): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const t of tasks) {
    if (typeof t.id !== "string" || !ID_RE.test(t.id)) {
      // ids flow into git branch/worktree commands; reject anything exotic.
      errs.push(`invalid task id: ${JSON.stringify(t.id)}`);
    }
    if (ids.has(t.id)) errs.push(`duplicate task id: ${t.id}`);
    ids.add(t.id);
  }
  for (const t of tasks) {
    for (const d of t.depends_on) {
      if (!ids.has(d)) errs.push(`task ${t.id} depends on missing task ${d}`);
    }
  }
  const cyc = findCycle(tasks);
  if (cyc) errs.push(`dependency cycle: ${cyc.join(" -> ")}`);
  return errs;
}

export function fixDeps(tasks: Task[]): Task[] {
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) t.depends_on = t.depends_on.filter((d) => ids.has(d));
  return tasks;
}

export function isClaimable(t: Task, retryBudget: number): boolean {
  return (
    (t.status === "pending" || t.status === "needs-work") &&
    t.attempts < retryBudget &&
    !t.passes
  );
}

export function ready(tasks: Task[], cfg: Config): Task[] {
  const passed = new Set(tasks.filter((t) => t.passes).map((t) => t.id));
  return tasks.filter(
    (t) =>
      isClaimable(t, cfg.run.retry_budget) &&
      t.depends_on.every((d) => passed.has(d)),
  );
}

export function order(readyTasks: Task[], allTasks: Task[]): Task[] {
  const dependents = new Map<string, number>();
  for (const t of allTasks) {
    for (const d of t.depends_on) dependents.set(d, (dependents.get(d) ?? 0) + 1);
  }
  return [...readyTasks].sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    const un = (dependents.get(b.id) ?? 0) - (dependents.get(a.id) ?? 0);
    if (un !== 0) return un;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function nextTask(tasks: Task[], cfg: Config): Task | null {
  const r = order(ready(tasks, cfg), tasks);
  return r.length > 0 ? r[0] : null;
}

/** Complete when every task is passed, or terminally scaffold/blocked. */
export function allDone(tasks: Task[]): boolean {
  return tasks.every(
    (t) => t.passes || t.status === "scaffold" || t.status === "blocked",
  );
}
