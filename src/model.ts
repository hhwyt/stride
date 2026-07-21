/** The task model + feature_list.json load/save. Unknown fields are preserved. */
import { readFileSync, writeFileSync } from "node:fs";

export type Status =
  | "pending"
  | "in-progress"
  | "done"
  | "blocked"
  | "scaffold"
  | "needs-work";
export type Priority = "high" | "medium" | "low";
export type Reachability = "WIRED" | "EXEMPT" | "ORPHAN" | null;

export interface Task {
  id: string;
  category: string;
  description: string;
  steps: string[];
  verify: string;
  depends_on: string[];
  priority: Priority;
  complexity: number | null;
  status: Status;
  passes: boolean;
  attempts: number;
  evidence: string | null;
  reachability: Reachability;
  [k: string]: unknown; // preserve unknown fields across load/save
}

export const PRIORITY_RANK: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function normalizeTask(t: Partial<Task> & { id: string }): Task {
  return {
    category: "functional",
    description: "",
    steps: [],
    verify: "",
    depends_on: [],
    priority: "medium",
    complexity: null,
    status: "pending",
    passes: false,
    attempts: 0,
    evidence: null,
    reachability: null,
    ...t,
  } as Task;
}

export function loadFeatures(path: string): Task[] {
  const raw = readFileSync(path, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid feature_list.json: ${(e as Error).message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error("feature_list.json must be a JSON array of tasks");
  }
  return data as Task[];
}

export function saveFeatures(tasks: Task[], path: string): void {
  writeFileSync(path, JSON.stringify(tasks, null, 2) + "\n");
}

export function byId(tasks: Task[], id: string): Task | undefined {
  return tasks.find((t) => t.id === id);
}

export function setPassed(tasks: Task[], id: string): void {
  const t = byId(tasks, id);
  if (!t) throw new Error(`no such task: ${id}`);
  t.passes = true;
  t.status = "done";
}

export function setStatus(tasks: Task[], id: string, status: Status): void {
  const t = byId(tasks, id);
  if (!t) throw new Error(`no such task: ${id}`);
  t.status = status;
  if (status !== "done") t.passes = false;
}
