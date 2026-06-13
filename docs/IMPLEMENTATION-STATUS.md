# Plan ↔ Implementation Status

Cross-reference of design plans in `plan/` against the codebase.  
Last audited: 2026-06-11.

---

## Summary

| Plan | Core status | Notes |
|------|-------------|-------|
| [architecture.md](../plan/architecture.md) | **Complete** | All 8 packages + `tools/` present; minor file layout differences documented below |
| [agents.md](../plan/agents.md) | **Complete** | Registry, ReAct, 6-level plans, sub-agents, orchestrator wired |
| [consistency-engine.md](../plan/consistency-engine.md) | **Complete** | sampler, voter, grader, feedback, 3-tier capability, RRP formula |
| [verification.md](../plan/verification.md) | **Complete** | 6 stages, plan weights, timeouts, rs/go runners |
| [python-bridge.md](../plan/python-bridge.md) | **Complete** | TCP/Unix, regex fallback, auth/connections stubs |
| [TOOLS.md](../plan/TOOLS.md) | **Complete** | All 44 table entries registered (plan doc says 43); omp-tier tools in `packages/engine/src/tool/mdc/` |

---

## architecture.md

### 7-layer stack

| Layer | Plan | Implementation |
|-------|------|----------------|
| L7 CLI/TUI | OpenTUI + React | `packages/tui/src/App.tsx`, `@opentui/react` |
| L6 Orchestrator | Plan/Build/Review + sub-agents | `packages/agent/src/orchestrator.ts` |
| L5 Consistency | Sampling + verification + RRP | `packages/consistency/` |
| L4 Context | Compaction, working memory, KG | `packages/context/` |
| L3 LLM | Multi-provider abstraction | `packages/llm/` |
| L2 Tools + Python | Engine tools + bridge | `packages/engine/src/tool/`, `packages/python-bridge/` |
| L1 Infrastructure | Effect, SQLite, config | `packages/engine/`, `packages/core/` |

### Monorepo files

| Planned path | Status | Actual |
|--------------|--------|--------|
| `agent/registry.ts` | ✅ | `packages/agent/src/registry.ts` |
| `consistency/voter.ts` | ✅ | `packages/consistency/src/voter.ts` |
| `consistency/feedback.ts` | ✅ | `packages/consistency/src/feedback.ts` |
| `verification/test-generated.ts` | ✅ | `packages/consistency/src/verification/test-generated.ts` |
| `context/type-index.ts` | ✅ | `packages/context/src/type-index.ts` |
| `context/example-index.ts` | ✅ | `packages/context/src/example-index.ts` |
| `context/working-memory.ts` | ✅ (relocated) | `packages/agent/src/working-memory.ts` |
| `llm/tool.ts` | ⏭ Deferred | LLM tools live in engine registry |

---

## agents.md

| Requirement | File(s) |
|-------------|---------|
| Agent registry + permissions | `packages/agent/src/registry.ts` |
| ReAct loop | `packages/agent/src/react.ts` — used by plan + build |
| Plan levels 1–6 prompts | `packages/agent/src/prompts/plan-level-{1..6}.txt` |
| Max LOC / depth enforcement | `packages/agent/src/plan-agent.ts` |
| Build + consistency loop | `packages/agent/src/build-agent.ts` → `sampler.ts` |
| Review actor-critique ×3 | `packages/agent/src/review-agent.ts` — Actor → Critic → Consensus; status emitted to TUI; critical/high routed to Build |
| Sub-agents | `packages/agent/src/sub-agents/{bugfix,feature,refactor,debug}.ts` |
| Refactor AST parse | `refactor.ts` → `treeSitter.parseAST` |

---

## consistency-engine.md

| Component | File |
|-----------|------|
| Multi-temp sampling | `packages/consistency/src/sampler.ts` |
| Voter | `packages/consistency/src/voter.ts` |
| RRP grader (0.5/0.3/0.2) | `packages/consistency/src/grader.ts` |
| AST consistency | `grader.ts` — tree-sitter via temp file + whitespace fallback |
| Feedback / retry prompts | `packages/consistency/src/feedback.ts` |
| Tier 1 registry | `model-capability/registry.ts` |
| Tier 2 benchmark + cache | `model-capability/benchmark.ts`, `.monkeydcode/capability-cache.json` |
| Tier 3 adaptive | `model-capability/detector.ts` — `recordPassRate()`, `.monkeydcode/capability-stats.json` |

---

## verification.md

| Stage | Weight | File | Timeout |
|-------|--------|------|---------|
| syntax | 0.10 | `verification/syntax.ts` | 5s |
| typecheck | 0.25 | `verification/typecheck.ts` | 30s |
| lint | 0.10 | `verification/lint.ts` | 15s |
| tests (existing) | 0.30 | `verification/test-existing.ts` | 120s |
| test-generated | 0.15 | `verification/test-generated.ts` | 60s |
| smoke | 0.10 | `verification/smoke.ts` | 30s |

**Integration:** per-step in sampler; full-changeset in `orchestrator.ts` before review; engine `verify` tool.

**Languages:** TS (tsc/biome/bun test), Python (mypy/ruff/pytest), Rust (rustc/clippy/cargo test), Go (go vet/golangci-lint/go test).

---

## python-bridge.md

| Component | Status |
|-----------|--------|
| `bridge.ts` spawn/lifecycle | ✅ lazy connect, TCP on Windows |
| `client.ts` + regex fallback | ✅ |
| `bridge_server.py` | ✅ JSON-RPC 2.0 |
| `tree_sitter_index.py` | ✅ |
| `knowledge_graph/` | ✅ NetworkX wrapper |
| `vector_store/` | ✅ ChromaDB |
| `auth/` | ✅ stub (`tools/src/auth/`) |
| `connections/` | ✅ stub (`tools/src/connections/`) |
| `scripts/setup-python.sh` | ✅ |

---

## TOOLS.md (43/44 tools)

All tools from the plan tables are registered in `packages/engine/src/tool/registry.ts` (always on — no feature flags).  
Internal opencode IDs (`bash`, `todowrite`, `plan_exit`, `fetch`, `search`, `patch`, `verify`) remain for compatibility; plan IDs are exposed via aliases (`shell`, `todo_write`, `plan`, `webfetch`, `websearch`, `apply_patch`, `verify_pipeline`).

Verified by `packages/engine/test/all-tools.test.ts`.

| Tier | Tools |
|------|-------|
| 1 | read, write, edit, apply_patch, glob, grep, repo_overview, repo_clone |
| 2 | shell, recipe, ssh, eval, job, calc |
| 3 | lsp, ast_edit, ast_grep, debug |
| 4 | git, github |
| 5 | webfetch, websearch, browser, localhost_view, generate_image, inspect_image |
| 6 | task, task_status, irc, plan, question, skill, todo_write |
| 7 | checkpoint, rewind, retain, recall, reflect, handoff |
| 8 | consistency_sample, verify_pipeline, model_probe, knowledge_graph, vector_search |

### Deferred (not in plan tables)

`invalid` — opencode internal fallback tool only.

---

## Running the stack

```bash
bun run typecheck
bun run test
bun run bench:verify-only   # offline benchmark validation
bun run dev                 # orchestrator TUI (needs LLM)
MDCODE_ECHO=1 bun run dev   # echo via session processor
```

**Ollama:** optional for local models; cloud providers work via config + API keys.
