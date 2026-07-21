// F036 — the MCP server: handshake, tools/list, and a full build driven over stdio.
import { afterEach, describe, expect, it } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { CLI, cleanup, tmpProject } from "./helpers.js";

const dirs: string[] = [];
const procs: ChildProcess[] = [];
afterEach(() => {
  procs.splice(0).forEach((p) => p.kill());
  dirs.splice(0).forEach(cleanup);
});

/** A minimal sequential JSON-RPC client over the server's stdio. */
function mcpClient(cwd: string) {
  const proc = spawn("node", [CLI, "mcp"], { cwd });
  procs.push(proc);
  const pending = new Map<number, (m: any) => void>();
  createInterface({ input: proc.stdout! }).on("line", (line) => {
    const t = line.trim();
    if (!t) return;
    let msg: any;
    try {
      msg = JSON.parse(t);
    } catch {
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  });
  let counter = 0;
  function call(method: string, params?: unknown): Promise<any> {
    const id = ++counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`mcp timeout: ${method}`));
      }, 15000);
      pending.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  const tool = (name: string, args: unknown = {}) =>
    call("tools/call", { name, arguments: args });
  return { call, tool };
}

describe("F036 MCP server", () => {
  it("handshakes and lists tools", async () => {
    const dir = tmpProject({ features: "# functional: a\n- x\nverify: t\n" });
    dirs.push(dir);
    const c = mcpClient(dir);
    const init = await c.call("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
    expect(init.result.serverInfo.name).toBe("stride");
    const list = await c.call("tools/list");
    const names = list.result.tools.map((t: any) => t.name);
    for (const n of ["stride_status", "stride_next", "stride_run", "stride_init", "stride_check", "stride_ready"]) {
      expect(names).toContain(n);
    }
  }, 20000);

  it("drives a whole build over the protocol (init -> next -> run -> status -> check)", async () => {
    const dir = tmpProject({
      features: "# functional: first\n- x\nverify: t first\n\n# functional: second\n- x\nverify: t second\n",
    });
    dirs.push(dir);
    const c = mcpClient(dir);
    await c.call("initialize", { protocolVersion: "2024-11-05", capabilities: {} });

    const init = await c.tool("stride_init");
    expect(init.result.content[0].text).toMatch(/initialized/);

    const next = await c.tool("stride_next");
    expect(next.result.content[0].text).toContain("F001");

    const ready = await c.tool("stride_ready");
    expect(ready.result.content[0].text).toContain("F001");

    const run = await c.tool("stride_run");
    expect(run.result.content[0].text).toMatch(/complete/);

    const status = await c.tool("stride_status");
    expect(status.result.content[0].text).toMatch(/2\/2/);

    const check = await c.tool("stride_check");
    expect(check.result.content[0].text).toMatch(/deps: ok/);
  }, 25000);

  it("reports a tool error as isError without crashing the server", async () => {
    const dir = tmpProject();
    dirs.push(dir);
    const c = mcpClient(dir);
    await c.call("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
    const bad = await c.tool("stride_bogus");
    expect(bad.result.isError).toBe(true);
    // server still alive: a follow-up call succeeds
    const list = await c.call("tools/list");
    expect(list.result.tools.length).toBeGreaterThan(0);
  }, 20000);
});
