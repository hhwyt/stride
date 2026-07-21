/**
 * The execution engine.
 *  - runSequential (-j1): the book loop — one task per iteration in the main tree.
 *  - runPipeline (-jN): claim ready tasks, build+verify each in its own worktree
 *    concurrently, then integrate (merge + smoke) serially so the base stays clean.
 * feature_list.json is mutated only in the main thread → no write races.
 */
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { Config, tierName } from "./config.js";
import { p } from "./paths.js";
import {
  Task,
  Reachability,
  loadFeatures,
  saveFeatures,
  byId,
} from "./model.js";
import { allDone, order, ready, validate } from "./graph.js";
import { buildPrompt, parseCost, resolveModel, runExecutor } from "./executor.js";
import {
  evaluatorGate,
  reachabilityGate,
  runTestGate,
  smokeGate,
} from "./gates.js";
import {
  appendCost,
  appendExecuteLog,
  appendProgress,
  readSteer,
  stopRequested,
  totalCost,
  tryLock,
  unlock,
  writeBlocked,
} from "./state.js";
import { commit, git, hasCommits, head, isRepo } from "./git.js";
import { addWorktree, mergeBranch, removeWorktree } from "./worktree.js";

export interface RunOptions {
  concurrency: number;
  once: boolean;
  maxIterations: number;
}

export interface RunResult {
  done: boolean;
  landed: string[];
  reason: string;
}

interface VerifyResult {
  ok: boolean;
  reason: string;
  evidencePath: string;
  reachability: Reachability;
  startSha: string;
  cost: number;
  model: string;
  branch?: string;
}

function relEvidence(evPath: string, root: string): string {
  return relative(root, evPath);
}

/** Build + verify a single task in `cwd`. Commits in `cwd` on success only. */
async function buildVerify(
  root: string,
  cfg: Config,
  task: Task,
  cwd: string,
  steer: string | null,
): Promise<VerifyResult> {
  const model = resolveModel(cfg, task);
  const startSha = isRepo(cwd) && hasCommits(cwd) ? head(cwd) : "";
  const base: Omit<VerifyResult, "ok" | "reason"> = {
    evidencePath: "",
    reachability: null,
    startSha,
    cost: 0,
    model,
  };

  const prompt = buildPrompt(task, "implement", steer ?? undefined);
  const ex = await runExecutor(cfg, cwd, root, task, prompt, "implement", steer);
  base.cost = parseCost(`${ex.stderr}\n${ex.stdout}`); // single match — avoid double-count

  const ev = runTestGate(cfg, cwd, root, task);
  base.evidencePath = relEvidence(ev.path, root);
  if (ev.code !== 0) {
    return { ...base, ok: false, reason: `exit-code gate failed (Exit ${ev.code})` };
  }

  git("add -A", cwd);
  const evalRes = await evaluatorGate(cfg, cwd, root, task);
  if (!evalRes.pass) {
    return { ...base, ok: false, reason: `evaluator: ${evalRes.reason}` };
  }

  const c = commit(cwd, `feat(${task.id}): ${task.description}`);
  if (c.code !== 0) {
    return { ...base, ok: false, reason: `commit failed: ${c.stderr.trim()}` };
  }
  base.reachability = reachabilityGate(cfg, cwd, startSha);
  return { ...base, ok: true, reason: "ok" };
}

function recordLanded(root: string, cfg: Config, taskId: string, res: VerifyResult): "done" | "scaffold" {
  const tasks = loadFeatures(p.featureList(root));
  const t = byId(tasks, taskId)!;
  const scaffold = res.reachability === "ORPHAN" && cfg.run.reachability_blocks;
  t.evidence = res.evidencePath;
  if (res.reachability) t.reachability = res.reachability;
  if (scaffold) {
    t.status = "scaffold";
    t.passes = false;
  } else {
    t.passes = true;
    t.status = "done";
  }
  saveFeatures(tasks, p.featureList(root));
  return scaffold ? "scaffold" : "done";
}

function recordFailure(
  root: string,
  cfg: Config,
  taskId: string,
  reason: string,
): "blocked" | "needs-work" {
  const tasks = loadFeatures(p.featureList(root));
  const t = byId(tasks, taskId)!;
  let outcome: "blocked" | "needs-work";
  if (t.attempts >= cfg.run.retry_budget) {
    t.status = "blocked";
    writeBlocked(root, taskId, t.description, reason);
    outcome = "blocked";
  } else {
    t.status = "needs-work";
    outcome = "needs-work";
  }
  saveFeatures(tasks, p.featureList(root));
  return outcome;
}

function bumpAttempt(root: string, taskId: string): number {
  const tasks = loadFeatures(p.featureList(root));
  const t = byId(tasks, taskId)!;
  t.attempts = (t.attempts ?? 0) + 1;
  saveFeatures(tasks, p.featureList(root));
  return t.attempts;
}

function setStatusPersist(root: string, taskId: string, status: Task["status"]): void {
  const tasks = loadFeatures(p.featureList(root));
  const t = byId(tasks, taskId)!;
  t.status = status;
  saveFeatures(tasks, p.featureList(root));
}

function emitLog(
  root: string,
  task: Task,
  cfg: Config,
  attempt: number,
  res: VerifyResult,
  outcome: string,
): void {
  appendExecuteLog(root, {
    ts: new Date().toISOString(),
    iteration: attempt,
    task_id: task.id,
    complexity: task.complexity,
    tier: tierName(task.complexity),
    model: res.model,
    outcome,
    reason: res.reason,
    reachability: res.reachability,
  });
  if (res.cost > 0) {
    appendCost(root, { task_id: task.id, model: res.model, cost: res.cost });
  }
}

async function runSequential(
  root: string,
  cfg: Config,
  opts: RunOptions,
): Promise<RunResult> {
  const landed: string[] = [];
  let iter = 0;
  while (true) {
    if (stopRequested(root)) return { done: false, landed, reason: "AGENT_STOP" };
    if (iter >= opts.maxIterations) return { done: false, landed, reason: "max_iterations" };
    if (cfg.budget.max_cost_usd > 0 && totalCost(root) >= cfg.budget.max_cost_usd) {
      return { done: false, landed, reason: "budget_exceeded" };
    }
    const tasks = loadFeatures(p.featureList(root));
    const errs = validate(tasks);
    if (errs.length) throw new Error(errs.join("; "));
    const candidate = order(ready(tasks, cfg), tasks)[0];
    if (!candidate) {
      return { done: allDone(tasks), landed, reason: allDone(tasks) ? "complete" : "no_ready_tasks" };
    }
    if (!smokeGate(cfg, root)) {
      return { done: false, landed, reason: "regression: smoke failing before task" };
    }
    iter++;
    const steer = readSteer(root);
    setStatusPersist(root, candidate.id, "in-progress");
    const res = await buildVerify(root, cfg, candidate, root, steer);
    const attempt = bumpAttempt(root, candidate.id);
    if (res.ok) {
      const outcome = recordLanded(root, cfg, candidate.id, res);
      if (outcome === "done") landed.push(candidate.id);
      appendProgress(root, `${candidate.id}: ${candidate.description}`, "next ready task");
      emitLog(root, candidate, cfg, attempt, res, outcome);
    } else {
      // Discard the failed attempt's code changes. feature_list.json is git-ignored
      // on-disk state, so reset/clean leave stride's bookkeeping (attempts) intact.
      if (res.startSha) {
        git(`reset --hard ${res.startSha}`, root);
        git("clean -fd", root);
      }
      const outcome = recordFailure(root, cfg, candidate.id, res.reason);
      emitLog(root, candidate, cfg, attempt, res, outcome);
    }
    if (opts.once) {
      const after = loadFeatures(p.featureList(root));
      return { done: allDone(after), landed, reason: "once" };
    }
  }
}

async function runPipeline(
  root: string,
  cfg: Config,
  opts: RunOptions,
): Promise<RunResult> {
  const landed: string[] = [];
  let seq = 0;
  let scheduled = 0;
  const inflight = new Map<
    number,
    Promise<{ key: number; task: Task; res: VerifyResult }>
  >();

  const fill = () => {
    while (inflight.size < opts.concurrency && scheduled < opts.maxIterations) {
      if (opts.once && scheduled >= 1) break;
      const tasks = loadFeatures(p.featureList(root));
      const errs = validate(tasks);
      if (errs.length) throw new Error(errs.join("; "));
      const cand = order(ready(tasks, cfg), tasks).find((t) => tryLock(root, t.id));
      if (!cand) break;
      scheduled++;
      setStatusPersist(root, cand.id, "in-progress");
      const steer = readSteer(root);
      const key = seq++;
      const prom = buildInWorktree(root, cfg, cand, steer).then((res) => ({
        key,
        task: cand,
        res,
      }));
      inflight.set(key, prom);
    }
  };

  while (true) {
    if (stopRequested(root)) {
      await Promise.allSettled([...inflight.values()]);
      return { done: false, landed, reason: "AGENT_STOP" };
    }
    fill();
    if (inflight.size === 0) {
      const tasks = loadFeatures(p.featureList(root));
      const reason = allDone(tasks)
        ? "complete"
        : scheduled >= opts.maxIterations
          ? "max_iterations"
          : "no_ready_tasks";
      return { done: allDone(tasks), landed, reason };
    }
    const settled = await Promise.race(inflight.values());
    inflight.delete(settled.key);
    const attempt = bumpAttempt(root, settled.task.id);
    const outcome = integrate(root, cfg, settled.task, settled.res);
    unlock(root, settled.task.id);
    emitLog(root, settled.task, cfg, attempt, settled.res, outcome);
    if (outcome === "done") landed.push(settled.task.id);
  }
}

async function buildInWorktree(
  root: string,
  cfg: Config,
  task: Task,
  steer: string | null,
): Promise<VerifyResult> {
  try {
    const wt = addWorktree(root, task.id);
    const res = await buildVerify(root, cfg, task, wt.path, steer);
    return { ...res, branch: wt.branch };
  } catch (e) {
    return {
      ok: false,
      reason: `worktree build error: ${(e as Error).message}`,
      evidencePath: "",
      reachability: null,
      startSha: "",
      cost: 0,
      model: resolveModel(cfg, task),
    };
  }
}

/** Serial integrate lane (main thread): merge the worker branch + regression smoke. */
function integrate(
  root: string,
  cfg: Config,
  task: Task,
  res: VerifyResult,
): string {
  if (!res.ok || !res.branch) {
    removeWorktree(root, task.id, res.branch);
    return recordFailure(root, cfg, task.id, res.reason);
  }
  const baseSha = head(root);
  const merged = mergeBranch(root, res.branch);
  if (!merged) {
    removeWorktree(root, task.id, res.branch);
    return recordFailure(root, cfg, task.id, "merge conflict on integrate");
  }
  if (!smokeGate(cfg, root)) {
    git(`reset --hard ${baseSha}`, root);
    removeWorktree(root, task.id, res.branch);
    return recordFailure(root, cfg, task.id, "regression: smoke failed after merge");
  }
  const outcome = recordLanded(root, cfg, task.id, res);
  removeWorktree(root, task.id, res.branch);
  appendProgress(root, `${task.id}: ${task.description}`, "next ready task");
  return outcome;
}

/**
 * Recover from an interrupted run (AGENT_STOP or a crash): reset in-progress tasks
 * to pending, clear stale locks, and prune leftover worktrees/branches. Without this,
 * an interrupted concurrent task would stay locked + in-progress forever.
 */
function reconcile(root: string): void {
  if (!existsSync(p.featureList(root))) return;
  const tasks = loadFeatures(p.featureList(root));
  let changed = false;
  for (const t of tasks) {
    if (t.status === "in-progress") {
      t.status = "pending";
      changed = true;
    }
  }
  if (changed) saveFeatures(tasks, p.featureList(root));
  try {
    for (const f of readdirSync(p.locksDir(root))) unlinkSync(join(p.locksDir(root), f));
  } catch {
    /* no locks dir */
  }
  if (isRepo(root)) {
    git("worktree prune", root);
    try {
      for (const d of readdirSync(p.wtDir(root))) removeWorktree(root, d, `stride/${d}`);
    } catch {
      /* no worktree dir */
    }
  }
}

export async function run(
  root: string,
  cfg: Config,
  overrides: Partial<RunOptions> = {},
): Promise<RunResult> {
  reconcile(root);
  const tasks = loadFeatures(p.featureList(root));
  const errs = validate(tasks);
  if (errs.length) throw new Error(errs.join("; "));
  const opts: RunOptions = {
    concurrency: overrides.concurrency ?? cfg.run.concurrency,
    once: overrides.once ?? false,
    maxIterations: overrides.maxIterations ?? cfg.run.max_iterations,
  };
  if (opts.concurrency <= 1) return runSequential(root, cfg, opts);
  return runPipeline(root, cfg, opts);
}
