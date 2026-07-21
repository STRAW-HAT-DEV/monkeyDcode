<div align="center">

# monkeyDcode

The coding agent that makes the model you already have actually reliable — not "beat GPT with a 7B," but make `qwen2.5-coder:7b` on your laptop produce work you can merge, every time, not on lucky rolls.

[![License: MIT](https://img.shields.io/github/license/STRAW-HAT-DEV/monkeyDcode)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/STRAW-HAT-DEV/monkeyDcode?style=social)](https://github.com/STRAW-HAT-DEV/monkeyDcode/stargazers)
[![Bun](https://img.shields.io/badge/runtime-Bun-f472b6)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6)](https://www.typescriptlang.org/)

[Quick start](#quick-start) · [Why this exists](#why-this-exists) · [How it actually works](#how-it-actually-works) · [Prove it yourself](#prove-it-yourself) · [vs. other agents](#how-this-compares)

</div>

---

## Why this exists

Point Claude Code, Cursor, or any frontier-tuned agent at a **local 7B model** and watch it fall apart — malformed patches, lost context, hallucinated files. Every major coding agent is built *assuming a frontier model underneath it*. If you're running Ollama on your own hardware — for privacy, for cost, because your org is air-gapped, or because API bills just hurt — none of them were built for you.

Here's the thing the whole industry just figured out: **the harness matters more than the model.** ["I improved 15 LLMs at coding in one afternoon. Only the harness changed."](https://blog.can.ac/2026/02/12/the-harness-problem/) The frontier models have converged; what actually separates a good coding agent from a bad one now is the scaffolding around the model — how it samples, verifies, retries, and recovers.

monkeyDcode is built entirely around that insight, for the model you're *actually* running, not the one a demo video assumes you have.

> **Honest framing, not hype:** we are not the only project making this bet — [Open Interpreter](https://github.com/openinterpreter/openinterpreter) (65k★) ships under the same "coding agent for low-cost models" banner. Their approach is picking the best existing *harness* per model. Ours is different: **cancel the model's variance with sampling and real verification.** See [how this compares](#how-this-compares) for the honest mechanism-by-mechanism breakdown — no competitor bashing, just what's actually different.

---

## How it actually works

A weak model isn't usually *wrong* about what to do — it's **inconsistent** in how it does it. Ask the same question five times, get two working answers, two malformed patches, and one hallucinated file. monkeyDcode is built to exploit exactly that:

```
mdc "fix the pagination bug"
        │
        ▼
  Detect model capability tier (1=frontier … 6=small local)
        │
        ▼
  Plan at the right granularity — atomic steps for weak models,
  coarse tasks for strong ones
        │
        ▼
  For each step: sample N candidates at different temperatures
        │
        ▼
  Verify EVERY candidate with real tools, not another LLM's opinion:
    syntax → typecheck → lint → tests → asset resolution → browser render
        │
        ▼
  Candidate fails?  →  targeted repair with the exact error, not a
                       blind full resample
        │
        ▼
  Step still failing after retries?  →  escalate JUST that step to a
                       stronger configured model, then drop back to local
        │
        ▼
  Patch applied via hashline — content-hashed, line-anchored edits that
  detect and reject a stale/misaligned patch instead of silently
  corrupting the file
        │
        ▼
  3-round actor-critic review, then done.
```

Every mechanism in that pipeline exists because a **coin-flip failure** — the model *knew* the right answer but fumbled the execution — is fixable by sampling + verification. A **skill-ceiling failure** — the task is genuinely past the model — isn't, and monkeyDcode doesn't pretend otherwise. That asymmetry is the whole thesis: **the smaller your model, the bigger the gap monkeyDcode closes.**

---

## Quick start

```bash
# Windows
.\scripts\install.ps1

# macOS/Linux
curl -fsSL https://raw.githubusercontent.com/STRAW-HAT-DEV/monkeyDcode/main/scripts/install.sh | bash
```

```bash
mdc
```

First run walks you through picking a provider (Ollama, OpenRouter, Anthropic, OpenAI, Groq, DeepSeek, or any OpenAI-compatible endpoint) and a model — zero config files to hand-write. Full platform-specific guide: [INSTALLATION.md](./INSTALLATION.md).

```bash
# Interactive session
mdc

# One-shot task, scriptable
mdc "Add pagination to the users API"
```

---

## What you get, concretely

- **Adaptive plan decomposition** — weak models get atomic steps; strong models get coarse tasks. The same request produces a different plan shape depending on what's actually running it.
- **Multi-temperature sampling + deterministic verification** — N candidates per step, graded by syntax → typecheck → lint → tests → asset resolution → real headless-browser render → smoke. The verifier is code, not another LLM's guess.
- **Hashline patches** — line-anchored edits with content hashes and per-line fingerprints. A stale or misaligned patch is *detected and rejected*, never silently applied wrong — the failure mode that wrecks small models on ordinary diff formats.
- **Hybrid local-first escalation** — everything runs on your local model by default; a step that exhausts its local repair budget escalates *just that step* to a configured stronger model, then drops back to local. You pay cloud prices for the 5% of steps that need it, not the other 95%.
- **Self-repair + self-tuning** — a failing candidate gets a targeted fix attempt fed its own exact errors before the agent gives up and resamples from scratch. With `self_tuning = true`, the sampler learns *your* model's best temperature distribution from local telemetry — no data ever leaves your machine.
- **Test-first step execution** — before implementing a step, the agent writes a failing check, confirms it's genuinely red, then implements until it's green. A weak model can't "look done" without actually being done.
- **Specialist sub-agents** — dedicated flows for bug-fix, broken-asset-fix, feature work, refactors, and debugging, instead of one generic prompt trying to do everything.
- **MCP, in both directions** — call external MCP servers during recon (configure under `[mcp.servers.*]`), *and* run `mdc mcp-server` to expose monkeyDcode's own `mdc_build` / `mdc_verify` / `mdc_check_assets` to Claude Desktop or any other MCP client.
- **Speaks ACP** — `mdc acp` runs the real agent (same code path as the CLI) inside any editor that speaks the Agent Client Protocol, starting with Zed.
- **Real browser verification** — an optional headless-Chromium render stage catches a JS-injected broken image or dead redirect that a static reference scan structurally cannot see.
- **Fine-grained permissions + `AGENTS.md`/`CLAUDE.md`** — allow/deny specific RUN diagnostics or MCP tools via `[permissions.rules.*]`; project-level instruction files are picked up automatically, the same convention Claude Code and other agents already use.
- **Best-effort process sandboxing** — every spawned process gets an environment allowlist (your LLM API keys can't leak into a spawned test run or a third-party MCP server); real OS-level sandboxing (bubblewrap / `sandbox-exec`) kicks in automatically on Linux/macOS when installed.

---

## Prove it yourself

Every other coding agent asks you to trust the demo. monkeyDcode ships the benchmark that would prove it wrong if it were: a three-arm comparison (raw model → one-shot baseline → full agent) across 14 tasks, including multi-file repo-level work, not toy single-file snippets.

```bash
bun run bench:raw        # arm 1 — bare model, zero scaffolding (the floor)
bun run bench:baseline   # arm 2 — one-shot with prompt engineering, no sampling
bun run bench            # arm 3 — the full agent
bun run bench:compare    # diff two result runs
```

The harness is real and already validated against a live local model — what's left is running the full batch on your own hardware and reading the uplift table it generates in `results/report.md`. We are not publishing a number here that we haven't run ourselves; the moment we have one, this section gets replaced with it. Full runbook: [benchmarks/README.md](benchmarks/README.md).

---

## How this compares

| Dimension | The majors (Claude Code, Cursor, Copilot, Aider…) | Open Interpreter | monkeyDcode |
| --- | --- | --- | --- |
| Built assuming | A frontier model | A frontier *or* low-cost model | A weak local model, scaling up |
| Core mechanism | Strong model + good tools | Pick the best harness per model | Sample + verify + repair to cancel variance |
| Edit format | Diff/patch (fails badly on small models) | Harness-dependent | Hashline — detects and rejects stale patches |
| Publishes uplift vs. raw prompting | Not applicable | Not published | Harness built, ready to run — see [Prove it yourself](#prove-it-yourself) |
| Local-first / air-gapped | Rare | Partial | Full agent loop runs offline; escalation is opt-in |

We are not claiming to be first, or better in every dimension — we're claiming a **different, complementary mechanism**, and we're the ones putting a falsifiable number next to the claim.

---

## MCP

**As a client** — the agent can call external MCP servers during its recon step. Add servers to `config.toml` (`mdc setup` prints the path):

```toml
[mcp.servers.filesystem]
type = "local"
command = ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path/to/allow"]
enabled = true
timeout_ms = 20000

[mcp.servers.remote-example]
type = "remote"
url = "https://example.com/mcp"
enabled = true
timeout_ms = 20000

[mcp.servers.remote-example.headers]
Authorization = "Bearer ${TOKEN}"
```

Only configured servers are ever reachable — the model can call an already-listed tool, never introduce a new server.

**As a server** — `mdc mcp-server` exposes `mdc_build`, `mdc_verify`, and `mdc_check_assets` over stdio for any MCP client (Claude Desktop, another agent, …) to call.

**As an editor agent** — `mdc acp` runs monkeyDcode as an [Agent Client Protocol](https://agentclientprotocol.com) agent over stdio, for any ACP-speaking editor.

---

## Development

```bash
bun install
bun run typecheck
bun run test
bun run bench               # full agent (consistency engine on)
bun run bench:baseline      # one-shot with prompt engineering, no sampling/voting
bun run bench:raw           # the floor — same model, zero scaffolding (run this first)
bun run bench:verify-only   # offline — validates expected benchmark solutions
bun run bench:compare       # compare two benchmark result JSON files

# Echo mode (session processor only, no orchestrator):
MDCODE_ECHO=1 bun run dev
```

## Architecture

```
mdc / mdc acp  →  TUI / ACP agent  →  Orchestrator  →  Plan/Build Agents
                                            │                  │
                                            │                  ▼
                                            │        Consistency Engine
                                            │      (sampling, repair, escalation)
                                            │                  │
                                            │                  ▼
                                            │       Verification Pipeline
                                            │  (syntax/typecheck/lint/tests/assets/browser)
                                            ▼
                              MCP client + Python Bridge (tree-sitter, vector store, graph)

mdc mcp-server  →  mdc_build / mdc_verify / mdc_check_assets  →  same Orchestrator
```

---

## Contributing

Found a gap, a rough edge, or a model this doesn't handle well yet? Issues and PRs are genuinely welcome — this project's whole premise is that the harness can always get better at cancelling a weak model's variance. If monkeyDcode is useful to you, a star helps more people running local models find it.

## License

MIT — see [LICENSE](LICENSE).
