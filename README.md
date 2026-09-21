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

## As a dsh plugin

Install benchkit into a dsh profile — local path or git address, no npm account needed:

```sh
dsh plugin --profile headless add "D:/path/to/benchkit"        # local dev
dsh plugin --profile headless add github:sunlightsl/benchkit   # anyone, straight from GitHub
```

Every agent session in that profile gains a **`benchkit` tool**: the agent can run the evaluation suite against its own harness and read the pass-rate report back — self-evaluation as a tool call. `passed`/`total` come back as structured output, the markdown report as rendered text.

```text
agent → benchkit(task="create-hello") → { passed: 1, total: 1, report: "…" }
```

Notes:
- The tool locates the host's dsh installation automatically (workspace or installed layout); override with the `dsh_repo` argument or `BENCHKIT_DSH_REPO`.
- Plugin code runs host-side, outside the workspace sandbox. The benchkit tool spawns subprocesses, so invoking it requires `danger-full-access` or per-call approval — the same posture as dsh's own `plugin_manager` tool.
- Launch the host through the dsh launcher (not a bare `node bin.js`) so the installation's plugin resolution stays healthy.

## Diff two runs

```sh
node bin/benchkit.mjs run --adapter dsh ... --tag baseline
# ...change something...
node bin/benchkit.mjs run --adapter dsh ... --tag candidate
node bin/benchkit.mjs diff --tag baseline --tag candidate
```

Per-task pass-rate deltas with duration medians. Repeats < 3 per side are labeled as hints, not signal — the tool refuses to invent significance.

## Self-improvement pipeline

benchkit eats its own cooking: every review round feeds a triage ledger.

```sh
node tools/review/panel.mjs --target . --files src/runner.mjs --dsh-repo ... --home ...
node tools/review/proposals.mjs ingest   # findings → state/proposals.jsonl
node tools/review/proposals.mjs list     # triage queue
node tools/review/proposals.mjs close <id> --status applied --note "..."
```

Findings (high/med, cross-persona agreement included) become proposals; `close` records the verdict — applied with evidence, or rejected with a reason. The ledger is append-only: status moves, history stays.

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
