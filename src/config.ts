/** stride.json load + defaults + stack detection + model routing. Zero deps. */
import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { p } from "./paths.js";

export interface Commands {
  build: string;
  dev: string;
  smoke: string;
  test: string;
}

export interface Config {
  project: { name: string };
  commands: Commands;
  run: {
    concurrency: number;
    max_iterations: number;
    retry_budget: number;
    evaluator: boolean;
    reachability: boolean;
    reachability_blocks: boolean;
  };
  executor: { command: string; prompt_via: "stdin" | "arg" };
  models: { fast: string; standard: string; capable: string };
  budget: { max_cost_usd: number };
}

export function defaults(): Config {
  return {
    project: { name: "project" },
    commands: { build: "", dev: "", smoke: "", test: "" },
    run: {
      concurrency: 1,
      max_iterations: 1000,
      retry_budget: 3,
      evaluator: false,
      reachability: true,
      reachability_blocks: false,
    },
    executor: {
      command: "claude -p --model {model} --permission-mode acceptEdits",
      prompt_via: "stdin",
    },
    models: {
      fast: "claude-haiku-4-5-20251001",
      standard: "claude-sonnet-5",
      capable: "claude-opus-4-8",
    },
    budget: { max_cost_usd: 0 },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function deepMerge(base: any, over: any): any {
  if (!isObject(over)) return base;
  for (const k of Object.keys(over)) {
    if (UNSAFE_KEYS.has(k)) continue; // prevent prototype pollution from stride.json
    if (isObject(base[k]) && isObject(over[k])) deepMerge(base[k], over[k]);
    else base[k] = over[k];
  }
  return base;
}

export function validateConfig(cfg: Config): void {
  if (!cfg.executor.command || cfg.executor.command.trim().length === 0) {
    throw new Error("stride.json: executor.command must not be empty");
  }
  if (!cfg.executor.command.includes("{model}")) {
    throw new Error(
      "stride.json: executor.command must contain the {model} placeholder (used for model routing)",
    );
  }
}

export function loadConfig(root: string): Config {
  const path = p.config(root);
  let over: unknown = {};
  if (existsSync(path)) {
    try {
      over = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      throw new Error(`invalid stride.json: ${(e as Error).message}`);
    }
  }
  const cfg = deepMerge(defaults(), over) as Config;
  if (cfg.project.name === "project") cfg.project.name = basename(root);
  validateConfig(cfg);
  return cfg;
}

export function detectStack(root: string): { stack: string; commands: Commands } {
  const has = (f: string) => existsSync(join(root, f));
  if (has("package.json")) {
    return {
      stack: "node",
      commands: {
        build: "npm run build --if-present",
        dev: "npm run dev",
        smoke: "npm test --silent",
        test: "npm test --silent",
      },
    };
  }
  if (has("pyproject.toml") || has("requirements.txt")) {
    return {
      stack: "python",
      commands: { build: "", dev: "", smoke: "pytest -q", test: "pytest -q" },
    };
  }
  if (has("Cargo.toml")) {
    return {
      stack: "rust",
      commands: {
        build: "cargo build",
        dev: "cargo run",
        smoke: "cargo test",
        test: "cargo test",
      },
    };
  }
  if (has("go.mod")) {
    return {
      stack: "go",
      commands: {
        build: "go build ./...",
        dev: "go run .",
        smoke: "go test ./...",
        test: "go test ./...",
      },
    };
  }
  return { stack: "unknown", commands: defaults().commands };
}

export function modelForComplexity(cfg: Config, complexity: number | null): string {
  const c = complexity ?? 5;
  if (c <= 4) return cfg.models.fast;
  if (c <= 7) return cfg.models.standard;
  return cfg.models.capable;
}

export function tierName(complexity: number | null): "fast" | "standard" | "capable" {
  const c = complexity ?? 5;
  if (c <= 4) return "fast";
  if (c <= 7) return "standard";
  return "capable";
}
