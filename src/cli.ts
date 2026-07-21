#!/usr/bin/env node
/** stride command-line interface. */
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { VERSION } from "./index.js";
import { p } from "./paths.js";
import { loadConfig } from "./config.js";
import { loadFeatures, saveFeatures } from "./model.js";
import { validate, fixDeps, ready, nextTask } from "./graph.js";
import { generate, sync, decomposeInput } from "./decompose.js";
import { init } from "./initializer.js";
import { run } from "./scheduler.js";
import { renderStatus } from "./status.js";
import { analyze, expand } from "./complexity.js";
import { gradeText } from "./grade.js";

const USAGE = `stride — evidence-gated build harness

Usage: stride <command> [options]

Commands:
  init [--prompt <goal>] [--plan <file>] [--design <path>...]
                       decompose input, scaffold state, git init + initial commit
  generate | sync      (re)generate feature_list.json from features.md (preserves passes)
  check [--fix]        grade the spec (placeholder scan) + validate the dependency graph
  analyze [--llm]      score task complexity 1-10 (heuristic by default)
  expand <id>          break a task into subtasks
  run [-j N] [--once] [--max-iterations N]
                       execute ready tasks (sequential at -j1, concurrent pipeline at -jN)
  status               plain-text progress / ready / blocked / cost
  next | ready         show the next task / all ready tasks
  add "<description>"  append a feature to features.md and regenerate

Global:
  --cwd <dir>          operate on this project directory (default: current dir)
  --version, --help
`;

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      concurrency: { type: "string", short: "j" },
      once: { type: "boolean" },
      "max-iterations": { type: "string" },
      fix: { type: "boolean" },
      llm: { type: "boolean" },
      cwd: { type: "string" },
      prompt: { type: "string" },
      plan: { type: "string" },
      design: { type: "string", multiple: true },
      version: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const cmd = argv[0];
  const { values, positionals } = parse(argv.slice(1));

  if (values.version || cmd === "--version") {
    console.log(VERSION);
    return 0;
  }
  if (values.help || cmd === "--help" || cmd === undefined) {
    console.log(USAGE);
    return 0;
  }

  const root = values.cwd ? resolve(String(values.cwd)) : process.cwd();

  switch (cmd) {
    case "init": {
      const cfg = loadConfig(root);
      if (values.prompt || values.plan || (values.design as string[] | undefined)?.length) {
        await decomposeInput(root, cfg, {
          prompt: values.prompt as string | undefined,
          plan: values.plan as string | undefined,
          design: values.design as string[] | undefined,
        });
      }
      init(root);
      console.log(`initialized stride in ${root}`);
      return 0;
    }

    case "generate":
    case "sync": {
      const tasks = sync(root);
      console.log(`generated ${tasks.length} tasks`);
      return 0;
    }

    case "status": {
      console.log(renderStatus(root));
      return 0;
    }

    case "next": {
      const cfg = loadConfig(root);
      const tasks = loadFeatures(p.featureList(root));
      const errs = validate(tasks);
      if (errs.length) {
        console.error(errs.join("; "));
        return 1;
      }
      const t = nextTask(tasks, cfg);
      console.log(t ? JSON.stringify(t, null, 2) : "{}");
      return 0;
    }

    case "ready": {
      const cfg = loadConfig(root);
      const tasks = loadFeatures(p.featureList(root));
      const errs = validate(tasks);
      if (errs.length) {
        console.error(errs.join("; "));
        return 1;
      }
      console.log(ready(tasks, cfg).map((t) => t.id).join("\n"));
      return 0;
    }

    case "check": {
      let bad = false;
      if (existsSync(p.featuresMd(root))) {
        const g = gradeText(readFileSync(p.featuresMd(root), "utf8"));
        if (!g.ok) {
          console.error(`spec grade: ${g.grade} — ${g.placeholders} placeholder(s): ${g.hits.join(", ")}`);
          bad = true;
        } else {
          console.log("spec grade: GOOD");
        }
      }
      if (existsSync(p.featureList(root))) {
        const tasks = loadFeatures(p.featureList(root));
        if (values.fix) {
          fixDeps(tasks);
          saveFeatures(tasks, p.featureList(root));
        }
        const errs = validate(tasks);
        if (errs.length) {
          console.error(errs.join("\n"));
          bad = true;
        } else {
          console.log("deps: ok");
        }
      }
      return bad ? 1 : 0;
    }

    case "analyze": {
      const cfg = loadConfig(root);
      const tasks = await analyze(root, cfg, { llm: Boolean(values.llm) });
      console.log(`analyzed ${tasks.length} tasks`);
      return 0;
    }

    case "expand": {
      const id = positionals[0];
      if (!id) {
        console.error("usage: stride expand <id>");
        return 1;
      }
      const tasks = expand(root, id);
      console.log(`expanded ${id}; ${tasks.length} tasks total`);
      return 0;
    }

    case "add": {
      const desc = positionals[0];
      if (!desc) {
        console.error('usage: stride add "<description>"');
        return 1;
      }
      appendFileSync(p.featuresMd(root), `\n# functional: ${desc}\n- implement\nverify: has an integration test\n`);
      const tasks = generate(root);
      console.log(`added; ${tasks.length} tasks total`);
      return 0;
    }

    case "run": {
      const cfg = loadConfig(root);
      const overrides: Parameters<typeof run>[2] = {};
      if (values.concurrency) overrides.concurrency = Number(values.concurrency);
      if (values.once) overrides.once = true;
      if (values["max-iterations"]) overrides.maxIterations = Number(values["max-iterations"]);
      const res = await run(root, cfg, overrides);
      console.log(`run: landed ${res.landed.length} (${res.landed.join(", ") || "-"}) — ${res.reason}`);
      return 0;
    }

    default:
      console.error(`unknown command: ${cmd}\n`);
      console.error(USAGE);
      return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(String((e as Error)?.message ?? e));
    process.exit(1);
  });
