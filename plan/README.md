# monkeyDcode Build Plan

A CLI coding agent that produces consistent, idempotent results regardless of LLM capability — whether you're using a 1T parameter Kimi model or a 30B parameter Qwen Coder.

## Where to Start

Follow these files **in order**. Each one tells you exactly what to do, what commands to run, and how to verify it worked before moving to the next step.

| Step | File | What You'll Build | Estimated Time |
|------|------|------------------|----------------|
| 0 | [00-prerequisites.md](00-prerequisites.md) | Install Bun, uv, gh, Biome | 30 min |
| 1 | [01-fork-and-scaffold.md](01-fork-and-scaffold.md) | Fork opencode, scaffold monorepo | 2-4 hours |
| 2 | [02-adopt-llm-package.md](02-adopt-llm-package.md) | Adopt LLM abstraction from opencode | 1 day |
| 3 | [03-adopt-engine-core.md](03-adopt-engine-core.md) | Adopt session, tool, storage, config | 2-3 days |
| 4 | [04-echo-milestone.md](04-echo-milestone.md) | First validation: echo agent works | 1 day |
| 5 | [05-verification-pipeline.md](05-verification-pipeline.md) | Build deterministic quality gate | 1 week |
| 6 | [06-consistency-engine.md](06-consistency-engine.md) | Multi-temperature sampling + RRP grading | 2 weeks |
| 7 | [07-plan-build-agents.md](07-plan-build-agents.md) | Adaptive Plan + Build agents | 1 week |
| 8 | [08-python-bridge.md](08-python-bridge.md) | TS<->Python JSON-RPC bridge | 1 week |
| 9 | [09-context-engineering.md](09-context-engineering.md) | Knowledge graph, signatures, memory | 2 weeks |
| 10 | [10-review-subagents.md](10-review-subagents.md) | Review + Bug-fix/Feature/Refactor/Debug | 1 week |
| 11 | [11-tui-and-installation.md](11-tui-and-installation.md) | TUI polish + install scripts | 1 week |
| 12 | [12-benchmarking.md](12-benchmarking.md) | Validate consistency across model sizes | 3 days |

## Reference Documents

Read these alongside the build steps — they're the **specs** that the build steps implement:

- [architecture.md](architecture.md) — 7-layer system architecture, monorepo structure
- [consistency-engine.md](consistency-engine.md) — Multi-temperature sampling algorithm, RRP grading
- [agents.md](agents.md) — Agent definitions, ReAct pattern, sub-agents
- [verification.md](verification.md) — Verification pipeline stages, language detection
- [python-bridge.md](python-bridge.md) — JSON-RPC protocol, Python module organization
- [TOOLS.md](TOOLS.md) — Complete 43-tool arsenal and build order

**Implementation audit:** see [../docs/IMPLEMENTATION-STATUS.md](../docs/IMPLEMENTATION-STATUS.md) for plan ↔ code cross-reference.

## The Big Idea

Most LLM coding agents fail when you swap a frontier model for a smaller one. monkeyDcode fixes this with three mechanisms:

1. **Adaptive Plan Decomposition** — Weak models get hyper-granular steps (<20 LOC each), strong models get coarse tasks. Same end result, different paths.

2. **Multi-Temperature Sampling** — Generate N candidates at varied temperatures (0.3-0.6), verify each, pick the most consistent winner. Convergent solutions tend to be correct.

3. **Deterministic Verification** — Every candidate passes through a model-independent pipeline (syntax -> typecheck -> lint -> tests -> smoke). The quality gate doesn't care which model produced the code.

## Build Philosophy

- **Stand on opencode's shoulders.** Don't rebuild LLM abstraction, tool system, or session management. Fork what they did well.
- **Validate early.** The Echo Milestone (step 4) is critical — don't move forward until you can prove the foundation works.
- **The consistency engine is the differentiator.** Everything before it is plumbing. Everything after it depends on it. Get steps 5-6 right.
- **Test with weak models from day one.** A Qwen 7B running locally via Ollama is your acceptance test. If it works there, it works anywhere.

## Stack

- **TypeScript** (Bun runtime) — agent core, TUI
- **Python** (uv) — tooling, auth, tree-sitter, knowledge graph, vector store
- **Shell** — installation scripts
- **Effect** — functional effect system (from opencode)
- **OpenTUI + React** — TUI framework
- **SQLite + Drizzle** — session persistence

## Success Criteria

You'll know monkeyDcode is working when:
- [ ] The same task produces semantically equivalent code with Qwen 7B and Claude Opus
- [ ] Verification pipeline catches errors before they reach the user
- [ ] Plan decomposition adapts to model size automatically
- [ ] Working memory persists across sessions
- [ ] Knowledge graph prevents hallucinated APIs
