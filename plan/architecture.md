# monkeyDcode Architecture

## 7-Layer Stack

```
Layer 7: CLI / TUI (OpenTUI + React)
         User input, rendering, keyboard handling, session lifecycle

Layer 6: Agent Orchestrator
         Plan Agent, Build Agent, Review Agent
         Sub-agents: Bug-fix, Feature, Refactor, Debug
         Agent registry, permission model, step limits

Layer 5: Consistency Engine  ← CORE INNOVATION
         Multi-temperature sampling with voting
         Verification pipeline (syntax, types, lint, test, smoke)
         RRP grading / candidate selection
         Model capability detection + adaptive decomposition

Layer 4: Session / Context Management
         Message accumulation and persistence
         Compaction (rolling summary, every 5 exchanges)
         Working memory file (goal, steps, constraints, errors)
         Knowledge graph context retrieval

Layer 3: LLM Abstraction (from opencode)
         Schema-first request/response model
         Route = Protocol + Endpoint + Auth + Framing
         Provider adapters (OpenAI, Anthropic, Google, Bedrock,
         Azure, xAI, DeepSeek, Qwen, Ollama, etc.)
         Streaming event architecture

Layer 2: Tool System + Python Bridge
         TypeScript tools (file ops, grep, glob, shell, LSP)
         Python tool host (tree-sitter, auth, connections)
         MCP integration for external APIs
         Tool permission model

Layer 1: Infrastructure
         Effect runtime, event bus, storage (SQLite/Drizzle)
         Configuration management, plugin system
```

## Monorepo Structure

```
monkeyDcode/
├── packages/
│   ├── llm/               # Adopted from opencode — multi-provider LLM abstraction
│   │   └── src/
│   │       ├── schema/     # LLMRequest, LLMResponse, LLMEvent, Message, Tool
│   │       ├── route/      # Client, executor, protocol, endpoint, auth, framing
│   │       ├── protocols/  # anthropic-messages, openai-chat, gemini, bedrock
│   │       ├── providers/  # Per-provider Route.make() definitions
│   │       ├── llm.ts      # request(), generate(), stream(), generateObject()
│   │       ├── provider.ts # Provider.make() factory
│   │       ├── tool.ts     # Tool definition helpers
│   │       └── tool-runtime.ts
│   │
│   ├── core/              # Adopted from opencode — shared schemas and catalog
│   │   └── src/
│   │       ├── model.ts    # Model catalog, capability metadata
│   │       ├── provider.ts # Provider registry
│   │       ├── schema.ts   # Shared schemas
│   │       └── event.ts    # Session events
│   │
│   ├── engine/            # Forked from opencode internals
│   │   └── src/
│   │       ├── effect/     # Effect runtime (bootstrap, service-use, runner)
│   │       ├── bus/        # Event bus for inter-component communication
│   │       ├── config/     # Configuration management
│   │       ├── storage/    # SQLite/Drizzle persistence
│   │       ├── session/    # Session lifecycle, processor loop, compaction
│   │       ├── tool/       # Tool registry and execution
│   │       ├── permission/ # Permission model
│   │       ├── lsp/        # Language Server Protocol
│   │       ├── mcp/        # Model Context Protocol
│   │       ├── git/        # Git integration
│   │       └── plugin/     # Plugin extensibility
│   │
│   ├── agent/             # NEW — Agent definitions and orchestration
│   │   └── src/
│   │       ├── registry.ts
│   │       ├── plan-agent.ts
│   │       ├── build-agent.ts
│   │       ├── review-agent.ts
│   │       ├── sub-agents/
│   │       │   ├── bugfix.ts
│   │       │   ├── feature.ts
│   │       │   ├── refactor.ts
│   │       │   └── debug.ts
│   │       └── prompts/
│   │
│   ├── consistency/       # NEW — The core innovation
│   │   └── src/
│   │       ├── sampler.ts
│   │       ├── voter.ts
│   │       ├── grader.ts
│   │       ├── feedback.ts
│   │       ├── verification/
│   │       │   ├── pipeline.ts
│   │       │   ├── syntax.ts
│   │       │   ├── typecheck.ts
│   │       │   ├── lint.ts
│   │       │   ├── test-existing.ts
│   │       │   ├── test-generated.ts
│   │       │   └── smoke.ts
│   │       └── model-capability/
│   │           ├── detector.ts
│   │           ├── benchmark.ts
│   │           └── registry.ts
│   │
│   ├── context/           # NEW — Context engineering
│   │   └── src/
│   │       ├── knowledge-graph.ts
│   │       ├── signature-index.ts
│   │       ├── type-index.ts
│   │       ├── example-index.ts
│   │       ├── vector-store.ts
│   │       ├── compaction.ts
│   │       ├── working-memory.ts
│   │       └── retriever.ts
│   │
│   ├── python-bridge/     # NEW — TypeScript <-> Python integration
│   │   └── src/
│   │       ├── bridge.ts
│   │       └── client.ts
│   │
│   └── tui/               # OpenTUI React frontend
│       └── src/
│           └── index.tsx
│
├── tools/                 # Python tooling package (existing)
│   ├── __init__.py
│   ├── main.py
│   ├── pyproject.toml
│   └── src/
│       ├── bridge_server.py
│       ├── tree_sitter_index.py
│       ├── auth/
│       ├── connections/
│       ├── knowledge_graph/
│       └── vector_store/
│
├── scripts/
│   ├── install.sh
│   └── setup-python.sh
│
├── plan/
└── docs/
```

## Key Dependencies

- **Bun** — runtime and package manager
- **Effect** — functional effect system (v4 beta, from opencode)
- **Drizzle** — SQLite ORM
- **OpenTUI + React** — TUI framework
- **tree-sitter** — AST parsing (via Python)
- **ChromaDB** — vector store (via Python)
- **code-review-graph** — knowledge graph (via Python)
