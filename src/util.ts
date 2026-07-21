/** Subprocess helpers. Sync for the sequential path, async for concurrent workers. */
import { spawn, spawnSync } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** POSIX single-quote escaping for values interpolated into `shell: true` commands. */
export function shq(s: string): string {
  return "'" + s.replaceAll("'", `'\\''`) + "'";
}

const MAX_BUFFER = 64 * 1024 * 1024;

export interface RunOpts {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

export function runSync(command: string, opts: RunOpts = {}): RunResult {
  const r = spawnSync(command, {
    shell: true,
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
  const code = r.status ?? (r.error ? 1 : 0);
  return { code, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function runAsync(command: string, opts: RunOpts = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: opts.cwd,
      env: opts.env ?? process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", () => resolve({ code: 1, stdout, stderr }));
  });
}
