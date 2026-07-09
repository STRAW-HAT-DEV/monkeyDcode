# monkeyDcode — Launch Positioning & Goal

> Internal doc: the goal we ship against, what we market, and why we win.
> Every public claim here must be backed by the three-arm benchmark
> (`benchmarks/README.md`) before it goes on a landing page.

---

## The Goal (v2, post-Phase-2)

**Make the model you already have produce work you can actually merge.**

Not "beat GPT with a 7B" — that's physics-denial. The measurable promise:

> For any model M, `monkeyDcode(M)` strictly beats `raw(M)` on real
> multi-file coding tasks — and for local models, the gap is dramatic.

Success metric: positive pass-rate uplift in the three-arm benchmark
(raw → baseline → full agent) across all 14 tasks, largest on the
multi-file repo tasks (11–14), on models from Qwen 7B up to Claude.

---

## Why this is a market gap (nobody else is standing here)

Every major coding agent — Claude Code, Cursor, Copilot Workspace,
Devin, OpenHands, Aider — is designed *assuming a frontier model*.
Point them at a local 7B and they fall apart: malformed edits, lost
context, hallucinated files. The millions of developers running Ollama
on a laptop — for privacy, cost, air-gapped compliance, or just because
API bills hurt — have **no agent built for them**.

monkeyDcode is the first agent whose *architecture* adapts to model
strength instead of assuming it.

---

## Unique differentiators (vs. every other agent, honestly)

1. **Capability-tiered everything.** The agent detects the model's tier
   (1 = frontier … 6 = small local) and changes its behavior: plan
   decomposition granularity, temperature sets, and even the *edit
   format* (weak models get full-file rewrites; strong models get
   surgical hashline patches). No other agent adapts its core protocol
   to model strength.

2. **Multi-temperature sampling + deterministic verification.** Instead
   of one generation and hope, we sample N candidates at different
   temperatures and grade each through a real pipeline — syntax →
   typecheck → lint → **actually running the tests** → smoke. The
   verifier is code, not another LLM, so a weak model's variance gets
   cancelled instead of trusted. This is the core uplift engine.

3. **Hashline: a patch format weak models can't fumble.** Line-anchored
   edits with content hashes and per-line fingerprints — stale or
   misaligned patches are *detected and rejected*, not silently applied
   wrong. Search/replace diffs (Aider-style) and unified diffs both
   fail badly on small models; hashline was designed for exactly that
   failure mode.

4. **Hybrid local-first escalation — per step, not per session.** Runs
   everything on your local model; when one step exhausts its repair
   budget, only *that step* escalates to a configured stronger model
   (bigger Ollama model or a Claude API call), then control returns
   local. You pay cloud prices for the 5% of steps that need it, not
   the 100%.

5. **Test-first step execution.** Before implementing a step, the agent
   generates a failing check, verifies it's genuinely red, implements,
   and requires it to go green — TDD as architecture, with automatic
   rollback of the check on failure. Weak models can't "look done"
   without being done.

6. **Self-repair + self-tuning from telemetry.** Failed candidates get
   targeted repair attempts before resampling. Every run records
   temperatures, formats, repair outcomes to local telemetry; with
   `self_tuning = true` the sampler learns *your* model's best
   temperature distribution on *your* machine. The agent gets better
   the more you use it — locally, no data leaves your box.

7. **An honesty benchmark built in.** Three arms — raw model, one-shot
   baseline, full agent — over 14 tasks including multi-file repo
   fixtures. The agent must beat its own model prompted raw or the
   number says so. No other agent ships its own falsification test.

---

## What to market (in order of trending potential)

### 1. The demo video (highest leverage)
Split screen: raw `qwen2.5-coder:7b` in Ollama vs. monkeyDcode on the
same 7B, same multi-file bug task (use task 11 from the benchmark).
Raw model flails; agent lands it with green tests. Caption:
**"Same 7B model. Same laptop. One of these merged."**
60 seconds, no voiceover needed. This is the r/LocalLLaMA front-page
asset.

### 2. The uplift table
The single most shareable artifact: pass-rate per model, raw vs. agent.
One screenshot of `results/report.md`. Do NOT publish before the full
batch has run.

### 3. Taglines to A/B
- "Your 7B, but reliable."
- "The coding agent for the GPU-poor."
- "Frontier-agent behavior from the model on your laptop."
- "Local-first. Cloud only when a step actually needs it."
- "We benchmark against our own model prompted raw — and publish it."

### 4. Launch channels, in order
1. **r/LocalLLaMA** — this audience *is* the ICP; demo video + uplift
   table + "we built the agent that assumes your model is weak."
2. **Hacker News (Show HN)** — lead with the honesty benchmark angle:
   "Show HN: A coding agent that publishes its uplift over its own raw
   model." HN rewards falsifiability and punishes hype.
3. **X/Twitter thread** — the split-screen video + the hashline
   explanation (format designed for weak models) as a technical thread.
4. **Ollama community / Discord** — integration story: `ollama pull` →
   `mdc` → working agent, zero API key.

### 5. Angles that differentiate from the noise
- **Privacy/compliance**: fully local agent loop; escalation is opt-in
  and explicit. Air-gapped orgs can run the whole thing offline.
- **Cost**: per-step escalation math — "cloud tokens for 1 hard step,
  not 400 easy ones."
- **Anti-hype positioning**: we say out loud that a 7B won't design
  your landing page like Opus. We promise *reliability uplift*, not
  magic. This candor is itself the brand.

---

## Claims discipline (do not skip)

| Claim | Allowed when |
| --- | --- |
| "Beats raw prompting on every model we tested" | Uplift table shows it, published in repo |
| "Biggest gains on local models" | Tasks 11–14 uplift at 7B/14B is positive & large |
| "SWE-bench score of X" | Never, until a Python verification adapter exists and a real run happened |
| "Self-improving" | Only phrased as "tunes sampling from local telemetry" |

The moment a number is real, replace the estimate. Nothing trends
harder than a small tool with receipts.
