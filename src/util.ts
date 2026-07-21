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
  timeoutMs?: number;
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
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (r: RunResult) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    // A hung executor (e.g. claude -p) must not freeze a long-running build.
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
        finish({ code: 124, stdout, stderr: `${stderr}\n[stride] executor timed out after ${opts.timeoutMs}ms` });
      }, opts.timeoutMs);
    }
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
    child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
    child.on("error", () => finish({ code: 1, stdout, stderr }));
  });
}
