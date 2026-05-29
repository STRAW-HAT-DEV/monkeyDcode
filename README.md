# monkeyDcode

> A model-agnostic terminal coding agent that makes **weak / local** models reliable through multi-sample verification.

[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)
[![Language: TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Status: Experimental](https://img.shields.io/badge/status-experimental-orange)](#status-early--experimental)

monkeyDcode is a coding agent for the terminal. It forks the excellent
[opencode](https://github.com/sst/opencode) LLM/engine layers and adds a research
bet on top: instead of trusting a single model response, it can **sample several
candidate changes, verify each one against real tooling (syntax, types, lint,
tests), and pick the survivor that holds up.** The goal is to let a small local
model — the kind you can run on your own machine — produce changes you can trust.

> **Heads up:** this is an early, experimental project. The chat TUI and the
> multi-provider LLM layer work today; the consistency engine and agent layers
> are real code but not yet wired end-to-end. The status table below is honest
> about what runs versus what's on the roadmap.

---

## Why it's different

Most coding agents assume a frontier model and fall apart on weaker ones. The
thesis behind monkeyDcode is **reliability through verification, not raw model
power**:

- **Multi-sample consistency.** Generate N candidates at varied temperatures,
  run each through a verification pipeline, and grade survivors by a
  Reliability-Risk-Penalty score (verification weight + cross-candidate
  consistency + cheap quality heuristics).
- **Capability-adaptive planning.** Detect a model's capability level and
  decompose tasks more finely for weaker models.
- **Real tooling in the loop.** Verification shells out to `bun build`, `tsc`,
  Biome/ruff and the project's own test command — not an LLM's opinion of
  correctness.
- **Model-agnostic by construction.** A schema-first LLM layer routes to
  Anthropic, OpenAI, DeepSeek, OpenRouter, or a local Ollama server behind one
  interface.

---

## Status: Early / Experimental

| Capability | State | Notes |
|---|---|---|
| Terminal chat UI (OpenTUI + React) | ✅ Works today | Streams tokens live from a local model |
| Streaming + SQLite session persistence | ✅ Works today | History survives across runs (`~/.local/share/monkeydcode/sessions.db`) |
| Multi-provider LLM layer | ✅ Works today | Anthropic, OpenAI, DeepSeek, OpenRouter, Ollama |
| Secrets via environment | ✅ Works today | Keys from `*_API_KEY` env; credentials stored `0600`; fail-fast on missing key |
| Verification pipeline (syntax/types/lint/tests) | ✅ Works today | Hardened against path traversal + predictable-temp races |
| TS ↔ Python bridge (JSON-RPC over a Unix socket) | ✅ Works today | Newline-delimited JSON-RPC; allowlisted methods; `0600` socket |
| Consistency sampler + grader | 🚧 Experimental | Compiles and unit-tested; not yet wired into the TUI |
| Plan / Build agents | 🚧 Experimental | Plan→verify→build loop exists; single-provider routing for now |
| Context retrieval (signatures, vector search) | 🚧 Experimental | Requires the optional Python deps (chromadb, tree-sitter) |
| Conversation compaction | 🚧 Roadmap | `shouldCompact` heuristic ships; `compact` is an honest `NotImplemented` stub |
| Knowledge-graph neighbors | 🚧 Roadmap | Returns empty until the TS wrapper lands |
| Voting / feedback loops | 🚧 Roadmap | Not implemented yet |

We deliberately ship **honest stubs that fail loudly** (`NotImplementedError`)
for unfinished logic rather than fake results.

---

## Architecture

A 7-layer stack (see [`plan/architecture.md`](./plan/architecture.md) for the full version):

```
Layer 7  CLI / TUI ......... OpenTUI + React: input, rendering, session lifecycle
Layer 6  Agent Orchestrator  Plan / Build agents, permissions, step limits      [exp]
Layer 5  Consistency Engine   Multi-temp sampling, verification, RRP grading      [exp] <- core bet
Layer 4  Context Management   Working memory, compaction, retrieval               [exp]
Layer 3  LLM Abstraction ....  Schema-first routes; Anthropic/OpenAI/Ollama/...   [ok]
Layer 2  Tools + Python Bridge TS tools + Python host (tree-sitter, vectors)      [ok] bridge
Layer 1  Infrastructure .....  Effect runtime, event bus, SQLite storage          [ok]
```

The repo is a Bun-workspaces monorepo. `packages/{core,engine,llm,sdk,plugin}`
are adopted/forked from opencode; `packages/{agent,consistency,context,python-bridge,tui}`
plus `tools/` (Python) are the monkeyDcode additions.

---

## Quickstart

**Prerequisites**

- [Bun](https://bun.sh) >= 1.3
- (optional) [Ollama](https://ollama.com) for local models
- (optional) [uv](https://docs.astral.sh/uv/) for the Python bridge/tools

```bash
bun install

# Type-check, test, and lint the whole workspace
bun run typecheck
bun test
bun run lint

# Run the TUI (defaults to a local Ollama model)
bun dev
```

> `bun run build` is aliased to `bun run typecheck`. These packages run directly
> from TypeScript under Bun — there is no separate bundling step — so a green
> type-check *is* a green build.

**Try it with a local model:**

```bash
ollama serve
ollama pull qwen2.5-coder:7b
bun dev
```

**Use a hosted provider** — set the matching key before launching:

```bash
export ANTHROPIC_API_KEY=...      # or OPENAI_API_KEY / DEEPSEEK_API_KEY / OPENROUTER_API_KEY
```

If a non-Ollama provider is selected without its key, monkeyDcode fails fast with
a clear `Missing API key` error instead of an opaque 401. Ollama needs no key.

---

## Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY` | Provider credentials (read from the environment, never hardcoded) |
| `MDC_PY_BRIDGE_CMD` | Override the command used to launch the Python bridge (default: `uv run python -m tools.bridge_server`) |
| `MDC_PY_BRIDGE_SOCKET` | Override the bridge Unix-socket path |
| `MDC_TOOLS_DIR` | Working directory for the Python bridge process |

Sessions persist to `~/.local/share/monkeydcode/`.

### Python tools (optional)

```bash
cd tools
uv sync
uv run ruff check .
uv run pytest          # heavy chromadb/sentence-transformers tests are excluded by default
```

---

## Development

```bash
bun run typecheck   # all packages, 0 errors
bun test            # hermetic, offline-green (no live Ollama/network required)
bun run lint        # Biome, scoped to the hand-written packages
```

Tests are hermetic by design: LLM calls and the Python bridge are mocked, and the
only tests that touch real tools are gated behind environment variables
(`MDC_PY_BRIDGE=1`) or the `heavy` pytest marker.

---

## Contributing

Contributions are welcome — especially on the experimental layers. Please read
the [Code of Conduct](./docs/CODE_OF_CONDUCT.md) and keep changes type-checked,
linted, and tested (`bun run typecheck && bun test && bun run lint`).

## Credits

Built on top of [opencode](https://github.com/sst/opencode) (LLM + engine layers)
and [OpenTUI](https://git.new/create-tui) for the terminal UI.

## License

[MIT](./LICENSE) © Rohan Prasen Kedari
