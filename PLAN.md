# stride — Implementation Plan

## What stride is
`stride` turns a goal (a one-line prompt, an existing plan doc, or one/more design files or a design directory) into a
dependency-ordered task graph, then drives a coding agent to implement every task with a
**one-task-per-session, evidence-gated, only-moves-forward** loop that can run sequentially or as a concurrent pipeline.
It is a **CLI-first tool** (self-contained, plain-file state, git-checkpointed), wrapped by an optional Claude Code **skill**
and an optional **MCP server**. Fully open source (Apache-2.0). No subscription, no paywall, no closed components.

Design lineage: the harness discipline comes from *Multi-Agent Development with Claude Code* (ch. "Managing Long-Running
Agent Sessions"); the rich task model is borrowed from `claude-task-master`; the mechanical verification gates are borrowed
from the Atlas engine (`prd-taskmaster`). stride reimplements the good ideas **natively and self-contained** — no external
plugin web, no license machinery.

## Non-goals
- No TUI/GUI (dropped by decision — plain-text `status` + `watch` only).
- No hosted service, no accounts, no telemetry-home.
- No new runtime dependencies: the engine is **TypeScript on Node ≥18 with zero runtime `dependencies`** — arg parsing via
  `node:util.parseArgs`, subprocesses via `node:child_process`, concurrency via a Promise-based worker pool, JSON config.
  Dev-only tooling: `typescript` + `vitest`. This keeps it auditable and `npx`-clean.

## The regression rule (non-negotiable — applies to every feature below)
Every feature ships with **at least one integration test** that drives the real `stride` CLI end-to-end (subprocess, on a
throwaway git repo, using the mock executor) and asserts on observable outcomes (files on disk, exit codes, git state).
- A feature is **not "done"** until its integration test is written and green.
- The **full `vitest` suite must pass before every commit** — this is stride dogfooding its own regression gate.
- **GitHub Actions runs the full suite on every push and PR** (F039); a red CI blocks merge. CI is the enforcement arm of this rule.
- Integration tests are permanent: they become the regression suite. New features must not break existing tests.
- Where a feature needs an LLM "agent", the test uses the **mock executor** (T0) so it runs deterministically offline.

## Architecture
### Package layout (the tool itself)
```
src/
  index.ts        # version + shared re-exports
  cli.ts          # CLI dispatch (node:util.parseArgs): init/check/analyze/expand/run/status/sync/next/ready/add
  paths.ts        # project layout constants + small IO helpers
  model.ts        # Task dataclass, FeatureList load/save (schema, round-trip)
  config.ts       # stride.json load (native JSON) + defaults + stack detection
  graph.ts        # DAG: deps, cycle detection, ready-set, ordering, validate/fix
  decompose.ts    # prompt/plan/design -> features.md ; features.md <-> feature_list.json
  complexity.ts   # analyze (1-10) + expand
  executor.ts     # pluggable coding-agent command; prompt assembly; model routing
  worktree.ts     # git worktree create/branch/merge/remove
  gates.ts        # exit-code gate, regression smoke, evaluator, reachability sweep
  scheduler.ts    # sequential run + concurrent pipeline (waves, integrate lane)
  state.ts        # progress log, execute-log.jsonl, cost ledger, locks, BLOCKED.md
  status.ts       # plain-text status render
  initializer.ts  # init: detect stack, scaffold, git init, initial commit
scripts/
  long-run.sh     # headless overnight loop (container guidance, kill-switch)
  mock-executor.sh# deterministic fake agent for tests/examples (T0)
skill/SKILL.md    # Claude Code skill wrapper
plugin.json       # Claude Code plugin manifest (optional install path)
install.sh, package.json, tsconfig.json, README.md, LICENSE
examples/todo-api/features.md
test/             # vitest integration tests (one+ per feature) + shared helpers (test/helpers.ts)
```
### Project layout stride creates in a target repo
```
<project>/
  stride.json          # config (commands, concurrency, gates, models)
  features.md          # human-editable input (book format + optional verify:/priority:)
  feature_list.json    # machine task graph — SOURCE OF TRUTH (only `passes`/`status` mutate)
  TASKS.md             # generated human-readable mirror
  claude-progress.txt  # append-only session handoff log
  AGENT_PROMPT.md      # per-task prompt template
  .stride/             # runtime artifacts (git-ignored)
    execute-log.jsonl  #   structured per-iteration rows
    cost.jsonl         #   cost ledger
    evidence/<id>.log  #   captured test output + "Exit status: N"
    locks/<id>         #   task locks (headless visibility)
    wt/<id>            #   git worktree for concurrent workers
  AGENT_STOP           # touch to stop gracefully (checked, never created by stride)
  STEER.md             # write mid-run guidance (consumed + cleared)
```
### Task schema (`feature_list.json` = JSON array of these)
```json
{ "id":"F001", "category":"functional", "description":"...", "steps":["..."],
  "verify":"integration-test description / assertion", "depends_on":["F000"],
  "priority":"high|medium|low", "complexity":5,
  "status":"pending|in-progress|done|blocked|scaffold|needs-work",
  "passes":false, "attempts":0, "evidence":".stride/evidence/F001.log",
  "reachability":"WIRED|EXEMPT|ORPHAN|null" }
```
### Executor contract (how a task gets built)
stride assembles a prompt (task + steps + verify + repo context) and runs the configured `executor.command` (default
`claude -p --model {model} --permission-mode acceptEdits`) in the task's working tree. The agent edits files. **stride
itself** then runs the `test` command and captures evidence — verification is mechanical and owned by stride, not
self-reported by the agent. `{model}` is substituted by complexity tier. Tests inject a mock executor via config.

## Features (each with dependencies, acceptance, and its regression-guarding integration test)

### Test infrastructure
**T0 — mock executor + vitest harness**  (deps: none)
- **Does:** `scripts/mock-executor.sh` reads a prompt on stdin and performs scripted file edits so a "task" can be
  "implemented" deterministically offline; `test/helpers.ts` provides a `tmpProject` helper (throwaway git repo with
  `stride.json` pointing at the mock) and a `run_cli` helper (subprocess wrapper around `stride`).
- **Acceptance:** a test can spin up an isolated project and invoke the real CLI without network/LLM.
- **Integration test** `harness.test.ts`: create a `tmp_project`, run `stride --version` and `stride status` via subprocess,
  assert exit 0 and expected files exist.

### Group A — Task model & state files
**F001 — feature_list.json load/save + schema**  (deps: T0)
- **Does:** `model.ts` load/save with strict round-trip; unknown fields preserved; only `passes`/`status`/`attempts`/
  `reachability` are mutable via helpers.
- **Acceptance:** load→save is byte-stable except intended mutations; malformed JSON errors clearly.
- **Integration test** `model_roundtrip.test.ts`: write a feature_list.json, `stride status` reads it, mutate one task's
  `passes` via helper, reload → exactly one field changed, all others identical.

**F002 — features.md → feature_list.json (`generate`), preserving passes**  (deps: F001)
- **Does:** parse book format (`# <cat>: <desc>` + `- steps`, optional `verify:`/`priority:` lines); assign `F###` ids by
  order; regeneration matches by description and keeps existing `passes:true`.
- **Acceptance:** editing features.md and regenerating never loses completed progress; changed descriptions = new task.
- **Integration test** `generate_preserve.test.ts`: generate; mark F002 passed; append a new feature to features.md; run
  `stride sync`; assert F002 still `passes:true`, new task present as `passes:false`.

**F003 — TASKS.md human mirror**  (deps: F001)
- **Does:** render feature_list.json to a readable checklist (status glyph, id, desc, deps).
- **Integration test** `tasks_md.test.ts`: generate → assert `TASKS.md` exists and lists every task id with a status marker.

**F004 — `sync` (features.md ⇄ feature_list.json)**  (deps: F002)
- **Does:** regenerate from edited features.md, preserve passes, refresh TASKS.md.
- **Integration test** `sync.test.ts`: covered jointly with F002 plus a description-change case → old task retired, progress
  intact for unchanged tasks.

### Group B — Dependency graph
**F005 — dependency model + cycle detection**  (deps: F001)
- **Does:** build DAG from `depends_on`; detect cycles; report the cycle path.
- **Integration test** `graph_cycle.test.ts`: craft a feature_list with A→B→A; `stride run`/`stride next` exits non-zero with
  a clear "dependency cycle: A -> B -> A" message; no task is run.

**F006 — ready-set computation**  (deps: F005)
- **Does:** ready = status in {pending,needs-work} ∧ attempts<budget ∧ all deps `passes:true` ∧ not locked.
- **Integration test** `ready_set.test.ts`: B depends on A (pending) → `stride ready` lists only A; mark A passed →
  `stride ready` now lists B.

**F007 — next/ready ordering**  (deps: F006)
- **Does:** order by priority → unblock-count (most dependents first) → id.
- **Integration test** `next_order.test.ts`: two ready tasks, one unblocking 3 others → `stride next` returns the
  higher-leverage one.

**F008 — validate/fix dependencies**  (deps: F005)
- **Does:** `stride check` reports dangling dep ids and cycles; `--fix` drops invalid refs.
- **Integration test** `validate_deps.test.ts`: feature_list references a non-existent dep id → `stride check` flags it;
  `--fix` removes it and check passes.

### Group C — Config & init
**F009 — stride.json load + defaults**  (deps: none)
- **Does:** `config.ts` reads `stride.json` via native `JSON.parse`; sane defaults for missing keys; validates command templates.
- **Integration test** `config.test.ts`: minimal stride.json → defaults filled; bad `[executor].command` (no `{model}`
  when routing enabled) → clear error.

**F010 — stack detection**  (deps: F009)
- **Does:** detect node/python/rust/go from repo markers → default build/dev/smoke/test commands.
- **Integration test** `stack_detect.test.ts`: seed a `package.json` project → `stride init` writes a stride.json whose
  `test` command is the node default; seed `pyproject.toml` → python default.

**F011 — `init` (scaffold + git init + initial commit, idempotent)**  (deps: F002, F003, F010)
- **Does:** create stride.json, generate feature_list.json + TASKS.md, write claude-progress.txt + AGENT_PROMPT.md +
  `.stride/`, add `.stride/` to .gitignore, `git init` if needed, make the initial commit; re-running is a no-op.
- **Integration test** `init.test.ts`: run `stride init` in an empty dir with a features.md → assert all scaffold files
  exist, `.stride/` gitignored, exactly one initial commit; run `stride init` again → no new commit, no error.

### Group D — Executor & prompt
**F012 — pluggable executor + model routing**  (deps: F009)
- **Does:** run `executor.command` (stdin or arg prompt) in a given cwd; substitute `{model}` by complexity tier
  (1-4 fast / 5-7 standard / 8-10 capable) from `[models]`.
- **Integration test** `executor_routing.test.ts`: mock executor echoes the resolved model into a file; a complexity-9 task
  routes to the `capable` model, a complexity-2 task to `fast`.

**F013 — per-task prompt assembly**  (deps: F001)
- **Does:** build the agent prompt from task fields + repo context + "implement exactly this one task; do not touch others".
- **Integration test** `prompt.test.ts`: mock executor writes the received prompt to a file → assert it contains the task
  description, its steps, its `verify`, and the single-task constraint.

### Group E — Gates (load-bearing verification)
**F014 — exit-code evidence gate (mechanical, unfakable)**  (deps: F009, F012)
- **Does:** run `test` command in the task tree; write stdout+stderr+`Exit status: N` to `.stride/evidence/<id>.log`; gate
  passes iff exit 0 — no narrative override.
- **Acceptance:** a task whose test exits non-zero is NEVER marked passed, whatever the agent reports.
- **Integration test** `gate_exitcode.test.ts`: mock executor "implements" but the `test` command exits 1 →
  `stride run --once` → task stays `passes:false`, status `needs-work`, evidence contains `Exit status: 1`, no feature
  commit added.

**F015 — regression smoke gate**  (deps: F014)
- **Does:** run `smoke` before starting a task and after each integrate; a broken smoke blocks progress / rejects a merge.
- **Integration test** `gate_regression.test.ts`: task A passes and lands; configure `smoke` to start failing; run task B →
  B's integrate is rejected and B is `needs-work`; main branch is unchanged (merge reverted).

**F016 — evaluator gate (optional, LLM)**  (deps: F014)
- **Does:** after exit-gate passes, ask the executor (read-only prompt: task+diff+evidence) for `PASS`/`NEEDS_WORK`; only
  PASS proceeds. Skipped when disabled or executor is the mock returning PASS.
- **Integration test** `gate_evaluator.test.ts`: mock executor scripted to return `NEEDS_WORK: reason` on evaluate →
  task not marked passed, reason recorded in execute-log; scripted `PASS` → task lands.

**F017 — reachability sweep**  (deps: F014)
- **Does:** for source modules added by a task (git diff), grep for importers; unimported module → `ORPHAN`. v1 default
  **warns and records** `reachability:ORPHAN` (config `reachability_blocks=false`); `=true` downgrades status to `scaffold`.
- **Integration test** `gate_reachability.test.ts`: mock adds an orphan module → task's `reachability` recorded `ORPHAN`,
  warning in log; with `reachability_blocks=true` the task status becomes `scaffold`, not `done`.

### Group F — Execution engine
**F018 — sequential run (`-j1`)**  (deps: F011, F013, F014, F015)
- **Does:** the book loop: regression smoke → claim next ready → run executor in main tree → exit-gate → (evaluator) →
  (reachability) → commit → mark passed → append progress + execute-log → repeat. `--once` runs a single iteration.
- **Acceptance:** each landed task = exactly one clean commit; loop stops when no ready tasks remain.
- **Integration test** `run_sequential.test.ts`: 3 dependent tasks + mock executor → `stride run` → all `passes:true`, 3
  feature commits in dependency order, progress log has 3 entries, working tree clean.

**F019 — worktree lifecycle**  (deps: none beyond git)
- **Does:** `git worktree add .stride/wt/<id> -b stride/<id>`; merge branch to base; `worktree remove` + branch delete.
- **Integration test** `worktree.test.ts`: create a worktree, commit in it, merge back, remove → base branch has the commit,
  `.stride/wt/<id>` gone, no stray branches.

**F020 — concurrent pipeline (`-jN`)**  (deps: F018, F019)
- **Does:** main loop fills up to N ready tasks; each builds+verifies in its own worktree (parallel, ThreadPoolExecutor);
  a **serialized integrate lane** merges finished workers into base + runs smoke. All main-repo git ops serialized.
- **Acceptance:** N independent tasks land concurrently; base branch always mergeable; no lost updates to feature_list.json
  (mutated only in the main thread).
- **Integration test** `run_concurrent.test.ts`: 6 independent tasks, `stride run -j3`, mock executor with a small sleep →
  all `passes:true`, 6 feature commits present, no merge conflicts, feature_list.json internally consistent (no dupes/drops).

**F021 — file-disjoint chunking within a wave**  (deps: F020)
- **Does:** within a ready wave, prefer co-scheduling tasks predicted (by declared touched paths / heuristic) to touch
  disjoint files, to reduce integrate conflicts.
- **Integration test** `disjoint_chunk.test.ts`: two ready tasks declared to touch the same file are NOT co-scheduled in the
  same wave (serialized); two touching different files ARE co-scheduled.

**F022 — retry budget + BLOCKED.md escape hatch**  (deps: F018)
- **Does:** `needs-work` tasks are re-claimable up to `retry_budget`; on exhaustion → status `blocked` + append to
  `.stride/BLOCKED.md` (what/tried/suggestion); the loop does not spin on it.
- **Integration test** `retry_blocked.test.ts`: mock executor always fails a task's test → after `retry_budget` attempts the
  task is `blocked`, BLOCKED.md names it, and the run does not exceed budget attempts.

**F023 — kill-switch + steer**  (deps: F018)
- **Does:** presence of `AGENT_STOP` halts the loop gracefully at the next iteration boundary; `STEER.md` content is folded
  into the next prompt then cleared.
- **Integration test** `kill_steer.test.ts`: pre-create `AGENT_STOP` → `stride run` completes zero tasks and exits cleanly;
  write `STEER.md` → next task's prompt (captured by mock) contains the steer text and STEER.md is emptied.

**F024 — max-iterations + budget cap**  (deps: F018)
- **Does:** stop after `max_iterations` or when `cost.jsonl` total exceeds `[budget].max_cost_usd` (0 = unlimited).
- **Integration test** `caps.test.ts`: set `max_iterations=1` with 3 ready tasks → exactly one task lands then the run stops.

### Group G — Observability
**F025 — execute-log.jsonl**  (deps: F018)
- **Does:** append one typed row per iteration (iteration, task_id, complexity, tier, gate verdicts, attempts, outcome).
- **Integration test** `execute_log.test.ts`: after a sequential run, every landed task has a row with the required typed
  fields and valid JSON per line.

**F026 — cost ledger**  (deps: F012)
- **Does:** record best-effort per-task cost/tokens/model to `.stride/cost.jsonl` (mock reports a fixed synthetic cost).
- **Integration test** `cost_ledger.test.ts`: run with mock → cost.jsonl has one entry per task; `stride status` prints a
  cumulative total.

**F027 — `status` (plain text)**  (deps: F006, F025)
- **Does:** print X/N (and %), counts by status, ready/blocked lists, in-flight, cumulative cost — one screen, no TUI.
- **Integration test** `status.test.ts`: mixed-state feature_list → `stride status` output contains the correct done count,
  the blocked task id, and the cost total.

### Group H — Complexity
**F028 — analyze-complexity**  (deps: F001, F012)
- **Does:** score each task 1-10 via executor; deterministic fallback (heuristic from step count) when no LLM.
- **Integration test** `analyze.test.ts`: mock returns fixed scores → `stride analyze` writes `complexity` on every task;
  with `--no-llm`, the heuristic fallback assigns scores in 1-10.

**F029 — expand**  (deps: F028)
- **Does:** break a high-complexity task into subtasks (as new tasks with a `parent`/dep link), preserving the graph.
- **Integration test** `expand.test.ts`: `stride expand F007` on a complexity-9 task → new subtasks exist, depend on/replace
  the parent correctly, no cycle introduced, existing passes preserved.

### Group I — Decompose (input adapters)
**F030 — decompose from `--prompt`**  (deps: F002, F012)
- **Does:** executor expands a one-line prompt into features.md (atomic, testable, each with a `verify:`), then generate.
- **Integration test** `decompose_prompt.test.ts`: mock executor emits a canned features.md → `stride init --prompt "..."`
  yields a feature_list.json with ≥1 task each carrying a non-empty `verify`.

**F031 — decompose from `--plan`**  (deps: F030)
- **Does:** parse an existing plan doc into features.md via executor.
- **Integration test** `decompose_plan.test.ts`: feed a plan.md fixture → tasks derived; every task has a `verify`.

**F032 — decompose from `--design` (file/dir, parallel fan-out)**  (deps: F030)
- **Does:** read one/more design files or a directory; fan-out a reader per file (bounded concurrency); merge → features.md.
- **Integration test** `decompose_design.test.ts`: a `docs/` dir with 3 design files + mock reader → merged feature_list
  covers all 3 files' features; single-file and directory inputs both work.

**F033 — spec grading gate (`check`)**  (deps: F009)
- **Does:** scan input (prompt/plan/design/features.md) for placeholders (`TBD/TODO/{{...}}`) and testability; hard-gate a
  failing grade before decomposition.
- **Integration test** `grade.test.ts`: input containing `TODO` → `stride check` grades NEEDS_WORK and blocks (exit non-zero);
  clean input passes.

### Group J — Surfaces & packaging
**F034 — CLI dispatch**  (deps: all command features)
- **Does:** `node:util.parseArgs` wiring for init/check/analyze/expand/run/status/sync/next/ready/add + `--version`, helpful errors.
- **Integration test** `cli.test.ts`: `stride --help` lists every subcommand; unknown subcommand exits non-zero with usage.

**F035 — SKILL.md wrapper**  (deps: F034)
- **Does:** a Claude Code skill that teaches when/how to call `stride ...`, interpret output, drive the interactive loop.
- **Integration test** `skill_meta.test.ts`: parse SKILL.md front-matter → valid `name`/`description`; body references the
  real `stride` subcommands (guards against command drift).

**F036 — MCP server (optional)**  (deps: F034)
- **Does:** expose `stride` verbs as MCP tools for other agents.
- **Integration test** `mcp.test.ts`: start the server in-process, call the `status` tool → returns structured JSON matching
  the CLI. (Marked optional; skipped if the stdlib-only MCP shim is not built.)

**F037 — long-run.sh headless loop**  (deps: F018)
- **Does:** a container-friendly `while` loop calling `stride run`, honoring `AGENT_STOP`, budget, and logging to
  `.stride/`; documents the "run in a container" safety note.
- **Integration test** `test_long_run.sh`: run the script against a tmp_project with mock executor and a 2-task feature_list
  → both tasks land, script exits 0, `AGENT_STOP` mid-run halts it.

**F038 — packaging (package.json, tsconfig.json, install.sh, plugin.json, README, LICENSE, examples)**  (deps: F034, F035)
- **Does:** `npm run build` compiles `src/` → `dist/`; the `bin` field exposes the `stride` command (usable via `npx` or
  `npm i -g`); `install.sh` copies the skill into `~/.claude/skills/`; Apache-2.0 LICENSE; README quickstart;
  `examples/todo-api/features.md`.
- **Integration test** `packaging.test.ts`: `npm ci && npm run build` → `node dist/cli.js --version` prints the version;
  `install.sh --dry-run` reports the correct skill target path; the example features.md generates a valid feature_list.json.

**F039 — GitHub Actions CI**  (deps: T0, F038)
- **Does:** `.github/workflows/ci.yml` runs `npm ci && npm run build && npm test` (the **full vitest suite**) on every push
  and pull request, across a Node matrix (18, 20, 22). The regression suite is the merge gate; a status badge goes in the
  README. Git is available on the runner (the engine shells out to `git`); no LLM is needed because all tests use the mock
  executor.
- **Acceptance:** every push/PR triggers the suite; a failing test fails the workflow; the matrix covers supported Node versions.
- **Integration test** `ci_config.test.ts`: parse `.github/workflows/ci.yml` → assert it triggers on `push` and
  `pull_request`, runs the vitest suite against the repo, and lists the expected Node matrix. This meta-test guards the CI
  config from silent drift (e.g. someone dropping the test step or a Node version).

## Build order (dependency-topological — one release, not phased)
T0 → F009 → F001 → F002/F003/F004 → F005/F006/F007/F008 → F010/F011 → F012/F013 →
F014 → F015/F016/F017 → F018 → F019 → F020 → F021 → F022/F023/F024 →
F025/F026/F027 → F028/F029 → F030/F031/F032/F033 → F034 → F035/F036/F037/F038 → F039.
Each node lands only when its integration test is green and the full suite still passes. F039 (CI) is wired early in
practice — the workflow file lands right after T0 so the suite runs on CI from the first push — but it formally depends on
the packaging metadata (F038) for the install step.

## Key decisions (locked)
- **TypeScript, zero runtime deps** — `node:util.parseArgs` for args, native `JSON.parse` for `stride.json` config, a
  Promise-based worker pool for concurrency; dev-only tooling is `typescript` + `vitest`.
- **Pluggable executor** — default `claude -p`; tests inject `scripts/mock-executor.sh`. Verification is owned by stride
  (mechanical exit-code gate), never self-reported by the agent.
- **`-j1` runs in the main tree (book original); `-jN` uses worktrees + a serialized integrate lane.** feature_list.json is
  mutated only in the main thread → no JSON write races.
- **Reachability v1 warns** (records `ORPHAN`) rather than blocking ship, to avoid dependency deadlocks; `reachability_blocks=true`
  opts into the stricter Atlas behavior.
- **LLM-dependent features** (decompose, analyze, evaluator, expand) degrade gracefully offline and are tested via the mock
  executor so CI stays deterministic.
