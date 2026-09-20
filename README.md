# benchkit

**Regression testing for agent configurations.** Verifiable capability *and* safety task suites that answer one question cheaply: *did my change — a prompt, a skill, an agent config — make my agent better or worse?*

大模型编程助手的"单元测试"：用程序化判分的小任务集，给你的 agent 配置跑回归测试。改一条 system prompt、加一个 skill 之后，花几分钱、几分钟拿到通过率对比，而不是靠感觉。

Existing agent evals are heavy (containers, big datasets, dollars per run) or vibes. benchkit is deliberately small: each task is a directory with a fixture, a prompt, and a programmatic verifier, so every verdict is *verify the world, not the self-report*. Tasks are fast (seconds), cheap (cents), and split into `dev` / `heldout` sets so you can tell real improvement from benchmark overfitting.

## Quick start

```sh
# against DeepSeek Harness (dsh)
node bin/benchkit.mjs run --adapter dsh --dsh-repo /path/to/deepseek-harness \
  --home ~/.dsh-bench --set dev --repeat 3 --tag baseline

# against any CLI agent
node bin/benchkit.mjs run --adapter command --cmd 'my-agent "{{prompt}}"' --set dev

# test an agent config change: put the candidate config in a directory and
node bin/benchkit.mjs run --adapter dsh --dsh-repo /path/to/deepseek-harness \
  --overlay ./my-config-candidate --set dev --tag candidate
```

Each run appends a row to `state/results.jsonl` and writes a markdown report to `state/`. Diff the pass rates across tags — that is your answer.

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

Early (v0.1). The runner, two adapters (dsh / generic command), 10 seed tasks (7 capability + 3 safety), verifier self-checks, and mock-agent e2e are in place. Roadmap: more adapters, a community task library, report trends over time, LLM-judge rubrics as a *secondary* signal only.

## Development

```sh
node tests/selfcheck.mjs        # three-polarity verifier integrity check
node tests/mock-agent-e2e.mjs   # full pipeline with a fake agent
```

MIT licensed. Task fixtures and injection samples are simulated and benign by design.
