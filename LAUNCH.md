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

## The market (contested — and that's the proof it's real)

**Read this before writing any "nobody else does this" copy. It would be false.**

The category we bet on is now mainstream: *"the frontier models inside these
tools have largely converged, and the harness around the model now does most of
the work."* ([The Harness Problem](https://blog.can.ac/2026/02/12/the-harness-problem/),
[harness-bench](https://www.neuralnoise.com/2026/harness-bench-wip/).)

Still true: the **majors** — Claude Code, Cursor, Copilot Workspace, Devin,
OpenHands, Aider — are designed *assuming a frontier model*. Point them at a
local 7B and they degrade badly: malformed edits, lost context, hallucinated
files. The developers running Ollama on a laptop (privacy, cost, air-gapped
compliance, or API bills just hurting) are still not who those tools are for.

**No longer true: that we're alone.**
[Open Interpreter](https://github.com/openinterpreter/openinterpreter) — 65.6k
stars, a Rust rewrite forked from OpenAI's Codex — now ships under the tagline
*"A coding agent for low-cost models."* That is our thesis, verbatim, with a
large head start. Pretending otherwise on a launch post would get us fact-checked
in the first comment.

**So the honest position is not "first" — it's "different, and provable":**

- They are a **harness multiplexer**: switch between existing harnesses
  (`claude-code`, `qwen-code`, `swe-agent`, `minimal`…) to find the one that
  suits a given model. Their bet: *the right harness per model wins.*
- We are a **consistency engine**: multi-temperature sampling + deterministic
  verification + repair. Our bet: *cancel the model's variance.*
- **They publish no benchmarks.** No metrics, no comparative evidence for the
  "optimized for low-cost models" claim. We have a three-arm benchmark built to
  answer exactly that.

That last point is the wedge. See "Claims discipline" below — and
`GAPS.md` Part 2 for the full competitive analysis.

---

## Differentiators (mechanisms no competitor has, including Open Interpreter)

These are checked against Open Interpreter's actual feature set, not against a
strawman. Each is a mechanism *they do not implement* — their approach is to
swap harnesses, not to cancel variance.

1. **Capability-tiered everything.** The agent detects the model's tier
   (1 = frontier … 6 = small local) and changes its behavior: plan
   decomposition granularity, temperature sets, and even the *edit
   format* (weak models get full-file rewrites; strong models get
   surgical hashline patches). Open Interpreter switches the *whole harness*
   per model; we adapt the protocol *within* one harness, continuously.

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

7. **An honesty benchmark built in — the wedge.** Three arms: raw model,
   one-shot baseline, full agent — over 14 tasks including multi-file repo
   fixtures. The agent must beat its own model prompted raw, or the number
   says so. **This is the one place the competition is wide open:** Open
   Interpreter claims "optimized for low-cost models" and publishes *no*
   benchmarks, metrics, or comparative evidence. Whoever shows the receipts
   first owns the category's credibility. That is a race we can win this
   month — the harness is built and idle.

8. **MCP, in both directions, plus real browser verification.** The agent
   can call external MCP servers during recon (`mdc.config.toml`'s
   `[mcp.servers.*]`), and monkeyDcode itself is callable as an MCP server
   (`mdc mcp-server` → `mdc_build`/`mdc_verify`/`mdc_check_assets`) from
   Claude Desktop or any other MCP client. Verification also now includes a
   real headless-browser render stage — catching a JS-injected broken image
   or a dead redirect that a static scan can't see — on top of, not instead
   of, the sampling/verification engine above. This closes the two
   highest-priority gaps identified against Open Interpreter (GAPS.md
   Part 2, C1/C2) without diluting the core bet.

9. **Speaks ACP — works inside your editor, not just your terminal.**
   `mdc acp` runs monkeyDcode as a real Agent Client Protocol agent, so any
   ACP-speaking editor (Zed today, more as the protocol spreads) can drive
   the actual sampling/verification engine directly — same code path as the
   CLI, not a stripped-down shim. Paired with fine-grained permission rules
   (`[permissions.rules.*]` — allow/deny specific RUN diagnostics or MCP
   tools) and automatic `AGENTS.md`/`CLAUDE.md` project-instruction pickup,
   the agent now fits into an existing team's editor and repo conventions
   instead of asking them to adopt a new terminal habit.

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

### 6. Prepare the answer to "how is this different from Open Interpreter?"

It **will** be the first comment on r/LocalLLaMA and HN. Not having a crisp,
non-defensive answer is how a launch dies. The answer:

> Open Interpreter picks the best existing *harness* for your model. We do
> something orthogonal: sample the model several times and grade every candidate
> through a real verifier (typecheck, lint, tests, asset resolution, a real
> headless-browser render) before anything lands. Different mechanism, and
> complementary. We also support MCP in both directions, so it's not a
> trade-off — you get the sampling/verification engine AND the same tool
> ecosystem. Also — we publish our uplift over our own raw model. As far as
> we can tell, nobody in this category has published theirs. Here's ours: [table].

Rules: **never disparage them** (they validated the category and have earned
their 65k stars), **never claim "first"** (false), and **lead with the number**.
If we don't have the number yet, we are not ready to launch.

---

## Claims discipline (do not skip)

| Claim | Allowed when |
| --- | --- |
| "Beats raw prompting on every model we tested" | Uplift table shows it, published in repo |
| "Biggest gains on local models" | Tasks 11–14 uplift at 7B/14B is positive & large |
| "SWE-bench score of X" | Never, until a Python verification adapter exists and a real run happened |
| "Self-improving" | Only phrased as "tunes sampling from local telemetry" |
| **"The first/only agent for local models"** | **Never — Open Interpreter (65k★) predates us with the same pitch. This claim is false and will be fact-checked immediately.** |
| "The only one that publishes its uplift" | Only after our benchmark has actually run, and phrased as "as far as we can tell" — their absence of published benchmarks is evidence of absence, not proof |
| "Better than Open Interpreter" | Never, unless we have benchmarked *them* head-to-head. Compare mechanisms, not verdicts. |
| "Fully sandboxed" / "OS-level isolation" | Only qualified — Linux/macOS get real bwrap/sandbox-exec wrapping when installed; Windows gets environment allowlisting only (see GAPS.md Part 2, C3). Never claim parity across all three OSes. |
| "Playwright-verified rendering" / visual QA claims | Only "checks that every resource loads" — never "checks the page looks right." That needs a vision model, which is a separate, still-open gap. |
| "Real-time streaming in your editor" (ACP) | Only "the reply appears once the turn completes" — the current implementation sends one message chunk per turn, not incremental token deltas. Don't imply token-by-token streaming until that's actually built. |

The moment a number is real, replace the estimate. Nothing trends
harder than a small tool with receipts.
