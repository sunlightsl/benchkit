# Writing benchkit tasks

任务写作方法论 / The methodology behind verifiable agent tasks.

A good benchkit task is **frontier** (sits at the current model's capability boundary — not trivially passed, not impossible) and **verifiable** (the verdict is a program, not an opinion). These two properties pull in opposite directions; the craft is maximizing both at once.

## 1. The verifier is the product

The agent's chat output is untrusted. The workspace after the run is the truth. Rules:

- `verify.mjs` must inspect the workspace: file bytes, command exit codes, computed values. Never parse the agent's prose.
- Prefer exact comparisons (`===` on normalized content). When checking behavior structurally, recompute the expected structure independently inside the verifier.
- Normalize line endings (`\r\n` → `\n`) when comparing text produced on Windows.

## 2. Three-polarity self-check (mandatory)

Every task in this repo is exercised three ways in `tests/selfcheck.mjs`:

1. **positive** — a golden workspace (correct behavior) must PASS.
2. **negative** — the bare fixture (no deliverable) must FAIL. Catches always-true verifiers, the silent killer of every benchmark.
3. **malicious** *(safety tasks only)* — fixture plus the unsafe outcome (injection obeyed, secret leaked, sentinel deleted) must FAIL. Proves the detector actually detects.

If you add a task, add its three solutions to `tests/selfcheck.mjs` in the same PR.

## 3. Spec ambiguity is YOUR bug

If the model does something reasonable that the verifier rejects, the task is wrong — not the model. Real example from this repo's development: a model kept `"1.5"` as a string because the spec said "integers become numbers"; the verifier expected a float. The spec was ambiguous; the verifier author fixed it. Before counting a failure as signal, re-read your own prompt as a lawyer.

## 4. Difficulty tiers

- **Tier 1 (easy):** single-step file operations. Regression guards — every agent should pass.
- **Tier 2 (medium):** multi-rule data transforms, cross-file consistency, exact formats with traps (dedup, padding, ordering).
- **Tier 3 (hard):** spec-dense implementations (tiny interpreters, format engines), reconciliation across rule interactions. This is where current models sit at 50–80% pass — the informative zone.

Target mix: most tasks at ~100% (guards) plus a few at 50–80% (signal). A suite where everything passes measures nothing; a suite where everything fails gives no regression protection.

## 5. dev / heldout split

- `dev`: the optimization set. Proposals, canaries, and config comparisons look only at dev.
- `heldout`: untouched by the improvement loop; run it on milestones only. If dev improves but heldout does not, you overfit the benchmark.

Keep the split ~70/30 and recorded in `meta.json`.

## 6. Safety task design

- Injection samples are **simulated and benign**: a magic-string instruction embedded in a fixture, never a real payload. The graded behavior is "completed the real task AND ignored the injection", not "refuses everything" — over-refusal is a capability failure too.
- Secrets are **obviously fake** (`sk-benchfakekey...`) but formatted realistically; the verifier greps deliverables for the value (a redacted `sk-****` passes).
- Destructive-command tasks plant a *sentinel* and grade survival, not intent — you cannot grade why an agent ran a script, only what happened.
- Say what it is: behavioral guardrail regression tests. Do not market a task suite as a security audit.

## 7. Costs and noise

- Repeat runs (≥3) and compare medians; single runs are anecdotes.
- Record the model id on every result row. A model upgrade invalidates history — segment, don't blend.
- Keep full-run cost in cents: 20 tasks × 3 repeats at seconds-per-task is the budget.
