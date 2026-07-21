/** Shared test helpers: throwaway project + real-CLI subprocess runner. */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, "..");
export const CLI = join(REPO, "dist", "cli.js");
export const MOCK = join(REPO, "scripts", "mock-executor.sh");
export const CHECK = join(REPO, "test", "fixtures", "mock-check.cjs");

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function deepMerge(base: any, over: any): any {
  if (!isObject(over)) return base;
  for (const k of Object.keys(over)) {
    if (isObject(base[k]) && isObject(over[k])) deepMerge(base[k], over[k]);
    else base[k] = over[k];
  }
  return base;
}

export function sh(cmd: string, cwd: string): void {
  execFileSync("bash", ["-c", cmd], { cwd, stdio: "ignore" });
}

export interface ProjectOpts {
  features?: string;
  config?: Record<string, unknown>;
  env?: Record<string, string>;
}

export function tmpProject(opts: ProjectOpts = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "stride-"));
  sh("git init -q", dir);
  sh('git config user.email "t@t.co"', dir);
  sh('git config user.name "stride-test"', dir);

  const cfg = deepMerge(
    {
      project: { name: "tmp" },
      commands: {
        build: "",
        dev: "",
        smoke: `node ${JSON.stringify(CHECK)} --smoke`,
        test: `node ${JSON.stringify(CHECK)}`,
      },
      executor: { command: `bash ${JSON.stringify(MOCK)} {model}`, prompt_via: "stdin" },
      run: {
        concurrency: 1,
        max_iterations: 1000,
        retry_budget: 3,
        evaluator: false,
        reachability: true,
        reachability_blocks: false,
      },
      models: { fast: "m-fast", standard: "m-standard", capable: "m-capable" },
      budget: { max_cost_usd: 0 },
    },
    opts.config ?? {},
  );
  writeFileSync(join(dir, "stride.json"), JSON.stringify(cfg, null, 2));
  // stride state files are on-disk-only (git-ignored), matching what `init` writes.
  writeFileSync(
    join(dir, ".gitignore"),
    ".stride/\nfeature_list.json\nTASKS.md\nclaude-progress.txt\nAGENT_STOP\nSTEER.md\n",
  );
  if (opts.features !== undefined) writeFileSync(join(dir, "features.md"), opts.features);
  return dir;
}

export function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): CliResult {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return {
      code: typeof e.status === "number" ? e.status : 1,
      stdout: e.stdout ? e.stdout.toString() : "",
      stderr: e.stderr ? e.stderr.toString() : "",
    };
  }
}

export function taskStub(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    category: "functional",
    description: `d${id}`,
    steps: ["do the work"],
    verify: "integration test asserts it",
    depends_on: [],
    priority: "medium",
    complexity: null,
    status: "pending",
    passes: false,
    attempts: 0,
    evidence: null,
    reachability: null,
    ...extra,
  };
}

export function writeFeatureList(dir: string, tasks: unknown[]): void {
  writeFileSync(join(dir, "feature_list.json"), JSON.stringify(tasks, null, 2) + "\n");
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}
export function readJson<T = any>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8"));
}
export function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
