/**
 * Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0), zero deps.
 * Exposes stride verbs as tools so any MCP client (Cursor, Windsurf, Roo, ...) can
 * drive a build. Started via `stride mcp`.
 */
import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { VERSION } from "./index.js";
import { p } from "./paths.js";
import { loadConfig } from "./config.js";
import { loadFeatures } from "./model.js";
import { nextTask, ready, validate } from "./graph.js";
import { renderStatus } from "./status.js";
import { run } from "./scheduler.js";
import { init } from "./initializer.js";
import { decomposeInput } from "./decompose.js";
import { gradeText } from "./grade.js";

const PROTOCOL_VERSION = "2024-11-05";

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const CWD_PROP = { cwd: { type: "string", description: "project directory (default: server cwd)" } };

export const TOOLS: Tool[] = [
  { name: "stride_status", description: "Progress, ready/blocked tasks, and cost.", inputSchema: { type: "object", properties: CWD_PROP } },
  { name: "stride_next", description: "The highest-priority ready task as JSON.", inputSchema: { type: "object", properties: CWD_PROP } },
  { name: "stride_ready", description: "Ids of all tasks whose dependencies are satisfied.", inputSchema: { type: "object", properties: CWD_PROP } },
  { name: "stride_check", description: "Grade the spec and validate the dependency graph.", inputSchema: { type: "object", properties: CWD_PROP } },
  {
    name: "stride_run",
    description: "Execute ready tasks (sequential or concurrent). Returns the run result.",
    inputSchema: {
      type: "object",
      properties: {
        ...CWD_PROP,
        concurrency: { type: "number" },
        once: { type: "boolean" },
        maxIterations: { type: "number" },
      },
    },
  },
  {
    name: "stride_init",
    description: "Decompose input into a task graph and scaffold the project.",
    inputSchema: { type: "object", properties: { ...CWD_PROP, prompt: { type: "string" } } },
  },
];

function text(t: string, isError = false) {
  return { content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) };
}

async function callTool(name: string, args: any) {
  const root = args?.cwd ? String(args.cwd) : process.cwd();
  switch (name) {
    case "stride_status":
      return text(renderStatus(root));
    case "stride_next": {
      const cfg = loadConfig(root);
      const tasks = loadFeatures(p.featureList(root));
      const errs = validate(tasks);
      if (errs.length) return text(errs.join("; "), true);
      const t = nextTask(tasks, cfg);
      return text(t ? JSON.stringify(t, null, 2) : "{}");
    }
    case "stride_ready": {
      const cfg = loadConfig(root);
      const tasks = loadFeatures(p.featureList(root));
      return text(ready(tasks, cfg).map((t) => t.id).join("\n"));
    }
    case "stride_check": {
      const out: string[] = [];
      if (existsSync(p.featuresMd(root))) {
        const g = gradeText(readFileSync(p.featuresMd(root), "utf8"));
        out.push(`spec: ${g.grade}${g.ok ? "" : ` (${g.hits.join(", ")})`}`);
      }
      if (existsSync(p.featureList(root))) {
        const errs = validate(loadFeatures(p.featureList(root)));
        out.push(errs.length ? errs.join("; ") : "deps: ok");
      }
      return text(out.join("\n") || "nothing to check");
    }
    case "stride_run": {
      const cfg = loadConfig(root);
      const res = await run(root, cfg, {
        concurrency: args?.concurrency,
        once: args?.once,
        maxIterations: args?.maxIterations,
      });
      return text(JSON.stringify(res));
    }
    case "stride_init": {
      const cfg = loadConfig(root);
      if (args?.prompt) await decomposeInput(root, cfg, { prompt: String(args.prompt) });
      init(root);
      return text(`initialized stride in ${root}`);
    }
    default:
      return text(`unknown tool: ${name}`, true);
  }
}

function send(msg: unknown): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

export function startMcpServer(): void {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: any;
    try {
      req = JSON.parse(trimmed);
    } catch {
      return; // ignore malformed lines
    }
    const { id, method, params } = req;
    try {
      if (method === "initialize") {
        send({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: "stride", version: VERSION },
          },
        });
        return;
      }
      if (method === "notifications/initialized") return; // notification, no reply
      if (method === "ping") {
        send({ jsonrpc: "2.0", id, result: {} });
        return;
      }
      if (method === "tools/list") {
        send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        return;
      }
      if (method === "tools/call") {
        const result = await callTool(params?.name, params?.arguments);
        send({ jsonrpc: "2.0", id, result });
        return;
      }
      if (id !== undefined) {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
      }
    } catch (e) {
      if (id !== undefined) {
        send({ jsonrpc: "2.0", id, error: { code: -32000, message: String((e as Error)?.message ?? e) } });
      }
    }
  });
  rl.on("close", () => process.exit(0));
}
