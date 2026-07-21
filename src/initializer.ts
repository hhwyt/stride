/** Initializer: detect stack, scaffold state files, git init, initial commit. Idempotent. */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { p } from "./paths.js";
import { defaults, detectStack } from "./config.js";
import { generate } from "./decompose.js";
import { git, hasCommits, isRepo } from "./git.js";

const AGENT_PROMPT_TEMPLATE = `You are a coding agent for a long-running project driven by stride.

Each session:
1. Read claude-progress.txt and \`git log\` to see recent work.
2. Run \`stride next\` to get the highest-priority ready task.
3. Implement that single task — nothing else.
4. Make the project's test command pass.
5. Commit; stride records progress and moves on.

Rules: one task per session; leave the tree clean and mergeable; never mark work
done without passing tests.
`;

export function init(root: string): void {
  mkdirSync(p.strideDir(root), { recursive: true });

  // 1. stride.json (only if absent) with detected stack commands
  if (!existsSync(p.config(root))) {
    const stack = detectStack(root);
    const cfg = defaults();
    cfg.project.name = root.split("/").filter(Boolean).pop() ?? "project";
    cfg.commands = stack.commands;
    writeFileSync(p.config(root), JSON.stringify(cfg, null, 2) + "\n");
  }

  // 2. .gitignore: stride's mutable state is on-disk-only, never git-tracked.
  //    This keeps `git reset`/merges from ever clobbering feature_list.json, and
  //    keeps feature commits limited to real project code. feature_list.json is
  //    still the on-disk source of truth; git history records each landed feature.
  const giPath = join(root, ".gitignore");
  const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  if (!gi.includes(".stride/")) {
    const sep = gi.length === 0 || gi.endsWith("\n") ? "" : "\n";
    appendFileSync(
      giPath,
      `${sep}.stride/\nfeature_list.json\nTASKS.md\nclaude-progress.txt\nAGENT_STOP\nSTEER.md\n`,
    );
  }

  // 3. progress log + agent prompt
  if (!existsSync(p.progress(root))) {
    writeFileSync(p.progress(root), "# stride progress log\n");
  }
  if (!existsSync(p.agentPrompt(root))) {
    writeFileSync(p.agentPrompt(root), AGENT_PROMPT_TEMPLATE);
  }

  // 4. feature_list.json + TASKS.md from features.md
  generate(root);

  // 5. git init + initial commit (only if no commits yet)
  if (!isRepo(root)) git("init -q", root);
  // Only inputs are tracked; derived/mutable state is git-ignored on-disk state.
  const tracked = ["stride.json", "features.md", "AGENT_PROMPT.md", ".gitignore"].filter(
    (f) => existsSync(join(root, f)),
  );
  git(`add ${tracked.join(" ")}`, root);
  if (!hasCommits(root)) {
    git("commit -q -F -", root, "chore: initialize stride harness");
  }
}
