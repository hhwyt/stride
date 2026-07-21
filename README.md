# stride

[![CI](https://github.com/hhwyt/stride/actions/workflows/ci.yml/badge.svg)](https://github.com/hhwyt/stride/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Turn a goal — a one-line prompt, an existing plan, or a folder of design docs — into a
dependency-ordered task graph, then let a coding agent build every task with an
**evidence-gated, only-moves-forward** loop. Runs one task at a time (the safe default) or
as a concurrent, worktree-isolated pipeline.

stride is a small CLI with **zero runtime dependencies**. State lives in plain files and git,
so a crashed or context-exhausted session always recovers. Fully open source (Apache-2.0) —
no subscription, no paywall, no closed components.

## Why
A single agent session hits hard limits: the context window fills, work is serial, and agents
either try to one-shot the whole project (and run out mid-way) or declare victory early. stride
fixes both by scoping each session to one task, proving it with a mechanical gate before it
counts as done, and checkpointing every landed feature to git.

## Install
```bash
npm install -g stride-harness      # the CLI
./install.sh                       # optional: the Claude Code skill
```
Or from source:
```bash
git clone https://github.com/hhwyt/stride && cd stride
npm ci && npm run build && npm link
```

## Quickstart
```bash
cd my-project
stride init --design ./docs        # or --prompt "build X" / --plan plan.md
stride check                       # grade the spec + validate the dependency graph
stride run                         # build sequentially (one clean commit per feature)
stride status                      # X/N done, ready, blocked, cost
```
Go faster with a concurrent pipeline (run this in a container):
```bash
stride run -j 4
```

## How it works
1. **Decompose** — your input becomes `features.md` (human-editable) and `feature_list.json`
   (the machine task graph: id, steps, verify, dependencies, complexity, status).
2. **Loop** — each iteration claims the highest-priority *ready* task (dependencies satisfied),
   runs the agent in a fresh context, then stride itself runs the gates.
3. **Gate** — a task counts as done only when its test command exits 0 (mechanical, unfakable),
   with optional independent evaluator and reachability checks. A regression smoke run guards
   existing features.
4. **Checkpoint** — each landed feature is one git commit; progress is appended to
   `claude-progress.txt`. Nothing moves backward.

## Commands
| Command | What it does |
|---|---|
| `stride init [--prompt/--plan/--design]` | decompose input, scaffold state, git init + initial commit |
| `stride generate` / `sync` | (re)build `feature_list.json` from `features.md`, preserving progress |
| `stride check [--fix]` | grade the spec (placeholder scan) + validate/fix the dependency graph |
| `stride analyze` / `expand <id>` | score complexity 1–10 / break a task into subtasks |
| `stride run [-j N] [--once] [--max-iterations N]` | execute (sequential at `-j1`, concurrent pipeline at `-jN`) |
| `stride status` / `next` / `ready` | plain-text progress / next task / ready set |

## Configuration (`stride.json`)
```json
{
  "commands": { "build": "npm run build", "smoke": "npm test", "test": "npm test" },
  "run": { "concurrency": 1, "retry_budget": 3, "evaluator": false, "reachability": true },
  "executor": { "command": "claude -p --model {model} --permission-mode acceptEdits" },
  "models": { "fast": "claude-haiku-4-5-20251001", "standard": "claude-sonnet-5", "capable": "claude-opus-4-8" }
}
```
The executor is pluggable — any command that reads a prompt on stdin and edits files works.
Complexity routes the model (`1-4` fast, `5-7` standard, `8-10` capable).

## Control while it runs
- `stride status` and `watch -n2 'stride status'` — no dashboard needed, it's all on disk.
- Write `STEER.md` to redirect the next task; `touch AGENT_STOP` to stop gracefully.
- Stuck tasks land in `.stride/BLOCKED.md` after the retry budget instead of spinning.

## MCP server — drive stride from another agent
stride ships an MCP (Model Context Protocol) server so any MCP client — Cursor, Windsurf, Roo,
Claude Code — can drive a build as native tool calls, instead of a human running the CLI. It's a
zero-dependency stdio JSON-RPC server started with `stride mcp`.

Add it to your MCP client config:
```json
{
  "mcpServers": {
    "stride": { "command": "stride", "args": ["mcp"] }
  }
}
```
Then your IDE's agent can call these tools:
| Tool | What it does |
|---|---|
| `stride_status` | progress, ready/blocked tasks, and cost |
| `stride_next` / `stride_ready` | the next task / all ready tasks |
| `stride_check` | grade the spec + validate the dependency graph |
| `stride_run` | execute ready tasks (args: `concurrency`, `once`, `maxIterations`) |
| `stride_init` | decompose input (`prompt`) and scaffold the project |

Every tool takes an optional `cwd` (defaults to where the server runs). Typical loop: the agent
calls `stride_next` to get a task, implements it, then `stride_status` to check progress — using
stride's task graph and gates as the backbone.

Two ways to use stride, same engine:
- **CLI / skill** — stride drives an executor (`claude -p`); you start it and watch.
- **MCP** — another agent drives stride, using it as a task-graph + gate layer inside its own loop.

## Design lineage
The one-task-per-session discipline comes from *Multi-Agent Development with Claude Code*. The
rich task model borrows from [claude-task-master](https://github.com/eyaltoledano/claude-task-master);
the mechanical evidence gates borrow from the Atlas engine. stride reimplements the good ideas
natively and self-contained.

## License
Apache-2.0.
