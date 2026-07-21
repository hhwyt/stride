/** Plain-text status. No TUI: one screen you can also watch with `watch`. */
import { existsSync } from "node:fs";
import { p } from "./paths.js";
import { loadFeatures } from "./model.js";
import { loadConfig } from "./config.js";
import { ready } from "./graph.js";
import { totalCost } from "./state.js";

export function renderStatus(root: string): string {
  if (!existsSync(p.featureList(root))) {
    return "no feature_list.json — run `stride init` first";
  }
  const tasks = loadFeatures(p.featureList(root));
  const cfg = loadConfig(root);
  const done = tasks.filter((t) => t.passes).length;
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    const k = t.passes ? "done" : t.status;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const rd = ready(tasks, cfg).map((t) => t.id);
  const blocked = tasks.filter((t) => t.status === "blocked").map((t) => t.id);
  const inprog = tasks.filter((t) => t.status === "in-progress").map((t) => t.id);
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  return [
    `stride: ${cfg.project.name}`,
    `progress: ${done}/${tasks.length} (${pct}%)`,
    `by status: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join("  ") || "-"}`,
    `ready: ${rd.join(", ") || "-"}`,
    `blocked: ${blocked.join(", ") || "-"}`,
    `in-progress: ${inprog.join(", ") || "-"}`,
    `cost: $${totalCost(root).toFixed(2)}`,
  ].join("\n");
}
