/** Thin wrappers over git. Used for checkpoints, worktrees, and diffs. */
import { runSync, RunResult } from "./util.js";

export function git(args: string, cwd: string, input?: string): RunResult {
  return runSync(`git ${args}`, { cwd, input });
}

export function isRepo(cwd: string): boolean {
  return git("rev-parse --git-dir", cwd).code === 0;
}

export function head(cwd: string): string {
  return git("rev-parse HEAD", cwd).stdout.trim();
}

export function hasCommits(cwd: string): boolean {
  return git("rev-parse HEAD", cwd).code === 0;
}

export function addAll(cwd: string): RunResult {
  return git("add -A", cwd);
}

export function commit(cwd: string, message: string): RunResult {
  // Message via stdin avoids shell-quoting hazards.
  return runSync("git commit -q -F -", { cwd, input: message });
}
