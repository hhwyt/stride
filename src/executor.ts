/** The pluggable coding agent: prompt assembly, model routing, invocation. */
import { Config, modelForComplexity } from "./config.js";
import { Task } from "./model.js";
import { runAsync, RunResult } from "./util.js";

export type Mode = "implement" | "evaluate" | "decompose";

export function resolveModel(cfg: Config, task: Task): string {
  return modelForComplexity(cfg, task.complexity);
}

export function buildPrompt(
  task: Task,
  mode: Mode,
  extra?: string,
): string {
  if (mode === "evaluate") {
    return [
      `You are a strict, independent reviewer. Decide whether the task below is correctly and completely implemented.`,
      `Task ${task.id}: ${task.description}`,
      `Verification requirement: ${task.verify || "(none stated)"}`,
      extra ? `Diff / evidence:\n${extra}` : "",
      `Reply with EXACTLY "PASS" or "NEEDS_WORK: <reason>" on the first line.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return [
    `You are a coding agent in a long-running project. Implement EXACTLY ONE task and nothing else.`,
    `Task ${task.id} [${task.category}, priority ${task.priority}]: ${task.description}`,
    task.steps.length ? `Steps:\n${task.steps.map((s) => `- ${s}`).join("\n")}` : "",
    task.verify ? `How this will be verified: ${task.verify}` : "",
    extra ? `Extra guidance: ${extra}` : "",
    `Do not modify unrelated features. When done, ensure the project's test command passes.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function envFor(
  cfg: Config,
  task: Task,
  root: string,
  mode: Mode,
  model: string,
  steer?: string | null,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    STRIDE_TASK_ID: task.id,
    STRIDE_ROOT: root,
    STRIDE_MODE: mode,
    STRIDE_MODEL: model,
    ...(steer ? { STRIDE_STEER: steer } : {}),
  };
}

export function parseCost(text: string): number {
  const m = text.match(/STRIDE_COST\s+([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

export async function runExecutor(
  cfg: Config,
  cwd: string,
  root: string,
  task: Task,
  prompt: string,
  mode: Mode,
  steer?: string | null,
): Promise<RunResult> {
  const model = resolveModel(cfg, task);
  const command = cfg.executor.command.replaceAll("{model}", model);
  const env = envFor(cfg, task, root, mode, model, steer);
  if (cfg.executor.prompt_via === "arg") {
    return runAsync(`${command} ${JSON.stringify(prompt)}`, { cwd, env });
  }
  return runAsync(command, { cwd, env, input: prompt });
}
