/**
 * Canonical file layout stride creates and reads inside a target project.
 * State lives on disk (plain files), so a fresh session or a crash can always
 * recover from feature_list.json + git.
 */
import { join } from "node:path";

export const CONFIG = "stride.json";
export const FEATURES_MD = "features.md";
export const FEATURE_LIST = "feature_list.json";
export const TASKS_MD = "TASKS.md";
export const PROGRESS = "claude-progress.txt";
export const AGENT_PROMPT = "AGENT_PROMPT.md";
export const STRIDE_DIR = ".stride";
export const STOP = "AGENT_STOP";
export const STEER = "STEER.md";

export const p = {
  config: (r: string) => join(r, CONFIG),
  featuresMd: (r: string) => join(r, FEATURES_MD),
  featureList: (r: string) => join(r, FEATURE_LIST),
  tasksMd: (r: string) => join(r, TASKS_MD),
  progress: (r: string) => join(r, PROGRESS),
  agentPrompt: (r: string) => join(r, AGENT_PROMPT),
  strideDir: (r: string) => join(r, STRIDE_DIR),
  evidenceDir: (r: string) => join(r, STRIDE_DIR, "evidence"),
  locksDir: (r: string) => join(r, STRIDE_DIR, "locks"),
  wtDir: (r: string) => join(r, STRIDE_DIR, "wt"),
  executeLog: (r: string) => join(r, STRIDE_DIR, "execute-log.jsonl"),
  costLog: (r: string) => join(r, STRIDE_DIR, "cost.jsonl"),
  blockedMd: (r: string) => join(r, STRIDE_DIR, "BLOCKED.md"),
  stop: (r: string) => join(r, STOP),
  steer: (r: string) => join(r, STEER),
};
