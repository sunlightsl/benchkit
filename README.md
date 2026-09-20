# benchkit

[![ci](https://github.com/sunlightsl/benchkit/actions/workflows/ci.yml/badge.svg)](https://github.com/sunlightsl/benchkit/actions/workflows/ci.yml)

**Regression testing for agent configurations.** Verifiable capability *and* safety task suites that answer one question cheaply: *did my change — a prompt, a skill, an agent config — make my agent better or worse?*

```sh
npx @sunlightsl/benchkit run --adapter command --cmd 'my-agent --cwd "{{workspace}}"' --set dev
```

大模型编程助手的"单元测试"：用程序化判分的小任务集，给你的 agent 配置跑回归测试。改一条 system prompt、加一个 skill 之后，花几分钱、几分钟拿到通过率对比，而不是靠感觉。

Existing agent evals are heavy (containers, big datasets, dollars per run) or vibes. benchkit is deliberately small: each task is a directory with a fixture, a prompt, and a programmatic verifier, so every verdict is *verify the world, not the self-report*. Tasks are fast (seconds), cheap (cents), and split into `dev` / `heldout` sets so you can tell real improvement from benchmark overfitting.

## Quick start

No build, no dependencies. Use it three ways:

```sh
# A. clone and run
git clone https://github.com/sunlightsl/benchkit.git && cd benchkit

# B. npx straight from GitHub (no npm account needed)
npx -p github:sunlightsl/benchkit benchkit --help

# C. as a dependency
npm install github:sunlightsl/benchkit
```

Then run tasks against an agent:

```sh
# against DeepSeek Harness (dsh)
node bin/benchkit.mjs run --adapter dsh --dsh-repo /path/to/deepseek-harness \
  --home ~/.dsh-bench --set dev --repeat 3 --tag baseline

# against any CLI agent — prompt via stdin (no shell interpolation of task text)
node bin/benchkit.mjs run --adapter command --cmd 'my-agent --cwd "{{workspace}}"' --set dev

# test an agent config change: put the candidate config in a directory and
node bin/benchkit.mjs run --adapter dsh --dsh-repo /path/to/deepseek-harness \
  --overlay ./my-config-candidate --set dev --tag candidate

# strict mode: also require the agent's own exit code to be success
node bin/benchkit.mjs run --adapter dsh --dsh-repo /path/to/deepseek-harness --require-success
```

Each run appends a row to `state/results.jsonl` and writes a markdown report to `state/`. Diff the pass rates across tags — that is your answer. By default `pass` means *the verifier passed*: the workspace is the ground truth. `--require-success` additionally folds the agent's exit code into the verdict.

## Task format

```
tasks/<id>/
├── meta.json     # { "id", "split": "dev|heldout", "tags": [...], "timeoutMs" }
├── prompt.txt    # the task given to the agent
├── fixture/      # copied into a fresh temp workspace before the run
└── verify.mjs    # programmatic verdict; exit 0 = pass, prints a JSON summary line
```

The workspace is the ground truth: the verifier checks files, runs programs, compares bytes. See [docs/writing-tasks.md](docs/writing-tasks.md) for the task-authoring methodology (frontier + verifiable, three-tier difficulty, dev/heldout discipline, and the three-polarity verifier self-check).

## Safety tasks

The `safety-*` tasks test behavioral guardrails, not vulnerabilities: does the agent obey prompt injections embedded in fixtures, leak planted secrets into deliverables, or run destructive scripts without inspection? They are **regression tests for agent behavior** — the claim is narrow on purpose. benchkit is not a security scanner.

## Project status

Early (v0.1). The runner, two adapters (dsh / generic command), 22 seed tasks (19 capability across three difficulty tiers + 3 safety), three-polarity verifier self-checks, edge-case regression tests, and a multi-persona AI review panel (`tools/review/`) are in place. Roadmap: more adapters, a community task library, report trends over time, LLM-judge rubrics as a *secondary* signal only.

## Self-review

```sh
node tools/review/panel.mjs --target . --files src/runner.mjs,src/adapters.mjs \
  --dsh-repo /path/to/deepseek-harness --home ~/.dsh-bench
```

Spawns one headless reviewer per persona (correctness / security / docs) in parallel, parses structured findings, dedups by signature, and boosts cross-persona agreement. Raw outputs are kept under `state/reviews/<ts>/` for audit.

## Development

```sh
node tests/selfcheck.mjs        # three-polarity verifier integrity check
node tests/mock-agent-e2e.mjs   # full pipeline with a fake agent
```

MIT licensed. Task fixtures and injection samples are simulated and benign by design.
