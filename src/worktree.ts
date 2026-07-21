/** Git worktree lifecycle for concurrent workers. */
import { join } from "node:path";
import { git } from "./git.js";
import { shq } from "./util.js";

export interface Worktree {
  path: string;
  branch: string;
  rel: string;
}

export function addWorktree(root: string, id: string): Worktree {
  const rel = join(".stride", "wt", id);
  const branch = `stride/${id}`;
  // Clean any stale worktree/branch from a prior aborted run.
  git(`worktree remove --force ${shq(rel)}`, root);
  git(`branch -D ${shq(branch)}`, root);
  const r = git(`worktree add -b ${shq(branch)} ${shq(rel)} HEAD`, root);
  if (r.code !== 0) throw new Error(`worktree add failed: ${r.stderr.trim()}`);
  return { path: join(root, rel), branch, rel };
}

/** Merge a worker branch into the base. Returns false on conflict (aborted). */
export function mergeBranch(root: string, branch: string): boolean {
  const r = git(`merge --no-ff -m ${shq(`integrate ${branch}`)} ${shq(branch)}`, root);
  if (r.code !== 0) {
    git("merge --abort", root);
    return false;
  }
  return true;
}

export function removeWorktree(root: string, id: string, branch?: string): void {
  const rel = join(".stride", "wt", id);
  git(`worktree remove --force ${shq(rel)}`, root);
  if (branch) git(`branch -D ${shq(branch)}`, root);
}
