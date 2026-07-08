# Benchmark Runbook — producing the uplift number

The headline claim ("agent output ≫ raw model output") is measured by a
three-arm comparison across all 14 tasks in `tasks/`. The harness is fully
validated (live-proven on qwen2.5-coder:7b); running the full batch is purely
a compute job. This runbook is everything needed to do it on a fresh machine.

## 1. Setup on the new machine

```bash
# Prereqs: Bun + Ollama installed
git clone <this repo> && cd monkeyDcode
bun install

# Required model — the project's acceptance gate:
ollama pull qwen2.5-coder:7b
# Optional, auto-detected and included if present:
ollama pull qwen2.5-coder:14b
ollama pull qwen2.5-coder:32b
# Optional cloud arm — Claude models are included only when this is set:
export ANTHROPIC_API_KEY=sk-ant-...
```

The model roster lives in `run.ts`'s `loadModels()`; `filterReachableModels()`
skips anything not actually available, so pulling more models simply widens
the comparison.

## 2. Smoke test first (~2 minutes)

```bash
bun run bench:raw -- --task 02 --model 7b
```

Expected: `02-fix-off-by-one ... ✅ PASS` in ~1 min. This confirms Ollama
connectivity and the harness end-to-end before you commit hours to the batch.

Note on `bun run bench:verify-only`: it runs each task's `expected/` tests
against the UNMODIFIED buggy starter, so most tasks failing is **expected and
correct** — it proves the tasks can't be passed without real work. What it
must NOT show is "Cannot find module" errors (that would mean a fixture
regression).

## 3. The full three-arm batch (budget: several hours at 7B speeds)

Run **in this order** — the uplift table in `results/report.md` compares
against the most recent `*-raw.json`, so raw must exist first:

```bash
bun run bench:raw        # arm 1: bare prompt, zero scaffolding (the floor)
bun run bench:baseline   # arm 2: one-shot + prompt engineering, no sampling
bun run bench            # arm 3: the full agent (slowest by far)
```

Rough timing on a 7B: raw ≈ 1 min/task; baseline similar; full agent can be
5–30+ min/task (multi-candidate sampling × repair × resample). Run unattended.

## 4. Reading the result

- Raw per-run JSON: `results/<timestamp>-<mode>.json`
- **The headline**: `results/report.md` → "Pass-Rate Uplift vs Raw" table
  (auto-generated for baseline/consistency runs). Uplift = this-arm − raw,
  per model. Positive uplift on tasks 11–14 (the multi-file repo tasks) is
  the number the whole project exists to demonstrate.
- Sampler internals per run: `.monkeydcode/telemetry/<date>.jsonl`
  (temperatures tried, repair attempts, formats, verification scores) —
  use this to debug any surprising result.

## 5. Optional live checks once a second model exists

**Escalation happy path (P2-2)** — needs a stronger second model:
edit the user config (`%APPDATA%\monkeydcode\config.toml` on Windows,
`~/.config/monkeydcode/config.toml` elsewhere):

```toml
[escalation]
enabled = true
provider = "ollama"            # or "anthropic"
model = "qwen2.5-coder:14b"    # or a Claude model id
```

Then give the agent a task the 7B fails; watch for the status line
"Escalated step N to <provider>/<model>" and a telemetry entry recorded under
the escalation model's own id.

**Self-tuning (P2-1)** — after ≥20 telemetry samples exist for a model, set
`self_tuning = true` under `[consistency]` and compare a re-run's uplift
against the static-default run (that's the P2-1 merge gate).

**Full test suite** — on a machine with Ollama up, the two Ollama-gated tests
(`consistency/test/sampler.test.ts`, `llm/test/smoke.test.ts`) actually run
instead of skipping; the sampler one exercises real inference and takes
minutes:

```bash
bun run typecheck && bun test packages
```
