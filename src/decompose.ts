/**
 * Input adapters + generation.
 * - parseFeaturesMd: the human-editable book format -> structured features.
 * - generate/sync: features.md -> feature_list.json (preserving `passes` by description).
 * - decomposeInput: prompt/plan/design -> features.md via the executor (LLM path).
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { p } from "./paths.js";
import { Task, Priority, loadFeatures, saveFeatures, normalizeTask } from "./model.js";
import { Config } from "./config.js";
import { runExecutor } from "./executor.js";

export interface ParsedFeature {
  category: string;
  description: string;
  steps: string[];
  verify: string;
  priority: Priority;
  depends_on: string[];
}

export function parseFeaturesMd(text: string): ParsedFeature[] {
  const out: ParsedFeature[] = [];
  let cur: ParsedFeature | null = null;
  const push = () => {
    if (cur && (cur.steps.length > 0 || cur.description)) out.push(cur);
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const head = line.match(/^#\s*([^:]+):\s*(.+)$/);
    if (head) {
      push();
      cur = {
        category: head[1].trim(),
        description: head[2].trim(),
        steps: [],
        verify: "",
        priority: "medium",
        depends_on: [],
      };
      continue;
    }
    if (!cur) continue;
    const step = line.match(/^-\s*(.+)$/);
    if (step) {
      cur.steps.push(step[1].trim());
      continue;
    }
    const verify = line.match(/^verify:\s*(.+)$/i);
    if (verify) {
      cur.verify = verify[1].trim();
      continue;
    }
    const prio = line.match(/^priority:\s*(high|medium|low)/i);
    if (prio) {
      cur.priority = prio[1].toLowerCase() as Priority;
      continue;
    }
    const deps = line.match(/^deps:\s*(.+)$/i);
    if (deps) {
      cur.depends_on = deps[1].split(/[,\s]+/).filter((x) => /^F\d+/.test(x));
      continue;
    }
  }
  push();
  return out;
}

export function renderTasksMd(tasks: Task[]): string {
  const glyph: Record<string, string> = {
    done: "[x]",
    pending: "[ ]",
    "in-progress": "[~]",
    blocked: "[!]",
    scaffold: "[s]",
    "needs-work": "[?]",
  };
  const lines = ["# Tasks", ""];
  for (const t of tasks) {
    const g = t.passes ? "[x]" : glyph[t.status] ?? "[ ]";
    const dep = t.depends_on.length ? ` (deps: ${t.depends_on.join(", ")})` : "";
    lines.push(`- ${g} ${t.id} — ${t.description}${dep}`);
  }
  return lines.join("\n") + "\n";
}

export function generate(root: string): Task[] {
  const md = existsSync(p.featuresMd(root))
    ? readFileSync(p.featuresMd(root), "utf8")
    : "";
  const parsed = parseFeaturesMd(md);
  const existing: Task[] = existsSync(p.featureList(root))
    ? loadFeatures(p.featureList(root))
    : [];
  const prevByDesc = new Map(existing.map((t) => [t.description, t]));
  const tasks: Task[] = parsed.map((f, i) => {
    const id = `F${String(i + 1).padStart(3, "0")}`;
    const prev = prevByDesc.get(f.description);
    const passed = prev?.passes === true;
    return normalizeTask({
      id,
      category: f.category,
      description: f.description,
      steps: f.steps,
      verify: f.verify,
      depends_on: f.depends_on,
      priority: f.priority,
      complexity: prev?.complexity ?? null,
      passes: passed,
      status: passed ? "done" : "pending",
      attempts: prev?.attempts ?? 0,
      evidence: prev?.evidence ?? null,
      reachability: (prev?.reachability as Task["reachability"]) ?? null,
    });
  });
  saveFeatures(tasks, p.featureList(root));
  writeFileSync(p.tasksMd(root), renderTasksMd(tasks));
  return tasks;
}

export function sync(root: string): Task[] {
  return generate(root);
}

function gatherDesign(paths: string[]): string {
  const chunks: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    if (statSync(path).isDirectory()) {
      for (const f of readdirSync(path)) {
        const full = join(path, f);
        if (statSync(full).isFile()) {
          chunks.push(`--- ${full} ---\n${readFileSync(full, "utf8")}`);
        }
      }
    } else {
      chunks.push(`--- ${path} ---\n${readFileSync(path, "utf8")}`);
    }
  }
  return chunks.join("\n\n");
}

/**
 * Turn a prompt / plan / design into features.md via the executor.
 * The executor is instructed to WRITE features.md in the project root.
 */
export async function decomposeInput(
  root: string,
  cfg: Config,
  input: { prompt?: string; plan?: string; design?: string[] },
): Promise<void> {
  const parts: string[] = [];
  if (input.prompt) parts.push(`Goal: ${input.prompt}`);
  if (input.plan && existsSync(input.plan)) {
    parts.push(`Existing plan (${input.plan}):\n${readFileSync(input.plan, "utf8")}`);
  }
  if (input.design && input.design.length > 0) {
    parts.push(`Design material:\n${gatherDesign(input.design)}`);
  }
  const prompt = [
    `Decompose the following into a flat list of atomic, independently testable features.`,
    `Output ONLY the features.md content — no preamble, no explanation, no code fences — in this exact format:`,
    `# <category>: <description>\n- <step>\n- <step>\nverify: <how an integration test proves it>\npriority: high|medium|low\ndeps: <space-separated feature ids this depends on, or omit the line>`,
    `Rules: every feature MUST have a concrete "verify:" line; keep features small and independently testable; order them so dependencies come first (ids are assigned by order as F001, F002, ...; reference them in "deps:"); no placeholders (TBD/TODO).`,
    parts.join("\n\n"),
  ].join("\n\n");

  const pseudoTask: Task = normalizeTask({
    id: "decompose",
    description: "decompose input into features.md",
  });
  // In headless print mode the agent returns the content on stdout rather than
  // reliably writing a file via a tool — so stride captures it and writes features.md.
  const res = await runExecutor(cfg, root, root, pseudoTask, prompt, "decompose");
  const content = extractFeaturesMd(res.stdout);
  if (content.trim().length > 1) writeFileSync(p.featuresMd(root), content);
}

/** Pull the features.md body out of an agent's stdout (strip fences/preamble). */
export function extractFeaturesMd(out: string): string {
  let s = out;
  const fence = s.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/);
  if (fence) s = fence[1];
  const idx = s.search(/^#\s/m);
  if (idx > 0) s = s.slice(idx);
  return s.trim() + "\n";
}
