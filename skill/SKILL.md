---
name: stride
description: Drive the stride harness — decompose a goal, plan, or design docs into a dependency-ordered task graph, then build it with an evidence-gated, only-moves-forward loop. Use when the user wants to autonomously implement a large multi-feature project, or asks to run/continue a stride build.
---

# stride

stride is a CLI. This skill teaches you when and how to call it. stride owns the
loop, the gates, and the git checkpoints — you drive it and interpret its output.

## When to use
- The user wants to build a whole multi-feature project autonomously.
- The user provides a goal, a plan file, or design docs and wants tasks implemented.
- The user says "run stride", "continue the stride build", or "keep building until done".

## Workflow
1. Decompose + scaffold (once):
   - `stride init --prompt "<goal>"`
   - `stride init --plan plan.md`
   - `stride init --design ./docs` (one or more files or a directory)
2. Sanity-check the spec and graph before building:
   - `stride check` — grades the spec (placeholder scan) and validates the dependency DAG.
   - `stride analyze` — score task complexity (drives model routing).
3. Build:
   - `stride run` — sequential (one task per session, the safest, most watchable mode).
   - `stride run -j 4` — concurrent pipeline (worktree-isolated workers, serial integrate).
   - `stride run --once` — a single iteration (good for stepping through interactively).
4. Observe and steer:
   - `stride status` — X/N done, ready, blocked, cost.
   - `stride next` / `stride ready` — what will run next.
   - Write `STEER.md` to redirect mid-run; `touch AGENT_STOP` to halt gracefully.

## Rules
- Never claim a task done without stride's gates passing — the exit-code gate is the source of truth.
- Prefer `stride run` (sequential) unless the user asks for speed; concurrent runs should be containerized.
- If `stride status` shows blocked tasks, read `.stride/BLOCKED.md` and help resolve them.
- Edit `features.md` (human-editable), then `stride sync` to regenerate while preserving progress.
