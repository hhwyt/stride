// F036 — the MCP server answers initialize, tools/list, and tools/call over stdio.
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { CLI, cleanup, runCli, tmpProject } from "./helpers.js";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(cleanup));

function mcpSession(cwd: string, requests: any[]): Promise<Map<number, any>> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [CLI, "mcp"], { cwd });
    const responses = new Map<number, any>();
    const wanted = requests.filter((r) => r.id !== undefined).map((r) => r.id);
    const rl = createInterface({ input: proc.stdout });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("mcp session timed out"));
    }, 15000);
    rl.on("line", (line) => {
      const t = line.trim();
      if (!t) return;
      let msg: any;
      try {
        msg = JSON.parse(t);
      } catch {
        return;
      }
      if (msg.id !== undefined) responses.set(msg.id, msg);
      if (wanted.every((id) => responses.has(id))) {
        clearTimeout(timer);
        proc.kill();
        resolve(responses);
      }
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    for (const r of requests) proc.stdin.write(JSON.stringify(r) + "\n");
  });
}

describe("F036 MCP server", () => {
  it(
    "handles initialize, tools/list, and a tools/call",
    async () => {
      const dir = tmpProject({ features: "# functional: a\n- x\nverify: t\n" });
      dirs.push(dir);
      runCli(["init"], dir);

      const res = await mcpSession(dir, [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {} } },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "stride_status", arguments: {} } },
      ]);

      expect(res.get(1).result.serverInfo.name).toBe("stride");
      expect(res.get(2).result.tools.map((t: any) => t.name)).toContain("stride_status");
      expect(res.get(3).result.content[0].text).toContain("progress:");
    },
    20000,
  );
});
