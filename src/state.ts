/** Plain-file state: progress log, execute log, cost ledger, locks, control files. */
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { p } from "./paths.js";

function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

export function appendProgress(root: string, completed: string, next: string): void {
  const line = `\n## ${stamp()}\n- Completed: ${completed}\n- Next: ${next}\n`;
  appendFileSync(p.progress(root), line);
}

export function appendExecuteLog(root: string, row: Record<string, unknown>): void {
  mkdirSync(p.strideDir(root), { recursive: true });
  appendFileSync(p.executeLog(root), JSON.stringify(row) + "\n");
}

export function appendCost(root: string, entry: Record<string, unknown>): void {
  mkdirSync(p.strideDir(root), { recursive: true });
  appendFileSync(p.costLog(root), JSON.stringify(entry) + "\n");
}

export function totalCost(root: string): number {
  if (!existsSync(p.costLog(root))) return 0;
  return readFileSync(p.costLog(root), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .reduce((sum, line) => {
      try {
        const v = JSON.parse(line);
        return sum + (typeof v.cost === "number" ? v.cost : 0);
      } catch {
        return sum;
      }
    }, 0);
}

export function writeBlocked(
  root: string,
  taskId: string,
  description: string,
  tried: string,
): void {
  mkdirSync(p.strideDir(root), { recursive: true });
  const block = `\n## ${taskId} — ${description}\n- Tried: ${tried}\n- Suggestion: needs human review; retry budget exhausted.\n`;
  appendFileSync(p.blockedMd(root), block);
}

export function stopRequested(root: string): boolean {
  return existsSync(p.stop(root));
}

/** Read STEER.md, clear it, return its content (or null). */
export function readSteer(root: string): string | null {
  if (!existsSync(p.steer(root))) return null;
  const s = readFileSync(p.steer(root), "utf8").trim();
  writeFileSync(p.steer(root), "");
  return s.length > 0 ? s : null;
}

export function tryLock(root: string, id: string): boolean {
  mkdirSync(p.locksDir(root), { recursive: true });
  try {
    const fd = openSync(join(p.locksDir(root), id), "wx");
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function unlock(root: string, id: string): void {
  try {
    unlinkSync(join(p.locksDir(root), id));
  } catch {
    /* already gone */
  }
}
