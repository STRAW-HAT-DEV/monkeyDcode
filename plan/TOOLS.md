# monkeyDcode — Complete Tool Arsenal

Target: The most capable tool set of any coding agent. Every tool below is either
adopted from opencode, stolen from omp/oh-my-pi, or exclusive to monkeyDcode.

---

## Sources We Raided

| Agent | What we took |
|-------|-------------|
| **opencode** (sst/opencode) | Engine core, 17 battle-tested tools, session/storage/bus/LSP/MCP |
| **omp / oh-my-pi** (can1357/oh-my-pi) | Hash-anchored editing, DAP debugging, AST edit/grep, eval cells, memory system, inter-agent IRC, job management |
| **Amp** (Sourcegraph) | Handoff instead of compaction, Oracle second-opinion pattern |
| **Cline / Cursor / Devin** | Playwright browser automation, localhost viewer |

---

## Tier 1 — Core File & Search (from opencode)

| Tool | Description |
|------|-------------|
| `read` | Read files with offset/limit; supports archives, SQLite, PDFs, URLs |
| `write` | Create or overwrite files |
| `edit` | Exact-string replacement with file locking |
| `apply_patch` | Apply unified diff patches |
| `glob` | File pattern discovery via ripgrep |
| `grep` | Regex content search across files, respects .gitignore |
| `repo_overview` | Summarise repository structure for the LLM |
| `repo_clone` | Clone a remote repo into the workspace |

---

## Tier 2 — Execution & Shell (from opencode + omp)

| Tool | Description | Source |
|------|-------------|--------|
| `shell` | PTY-backed shell with persistent sessions across calls | opencode |
| `recipe` | Invoke task runners: bun, make, just, cargo, npm | omp |
| `ssh` | Execute commands on remote machines | omp |
| `eval` | Persistent Python and JavaScript REPL cells with tool re-entry | omp |
| `job` | Background job management — start, stop, list, watch output | omp |
| `calc` | Deterministic arithmetic (never trust the LLM for maths) | omp |

---

## Tier 3 — Code Intelligence (from opencode + omp)

| Tool | Description | Source |
|------|-------------|--------|
| `lsp` | Live LSP: diagnostics, go-to-definition, references, rename, code actions | opencode |
| `ast_edit` | Structural code rewrites using tree-sitter AST (no regex hacks) | omp |
| `ast_grep` | Structural pattern queries across 50+ tree-sitter grammars | omp |
| `debug` | DAP debugging: lldb (native), dlv (Go), debugpy (Python) — breakpoints, stepping, variables | omp |

---

## Tier 4 — Git & Version Control

| Tool | Description | Source |
|------|-------------|--------|
| `git` | Full git operations: status, diff, commit, branch, blame, log, stash | opencode (engine/git) |
| `github` | GitHub CLI: PRs, issues, reviews, comments, Actions | omp |

---

## Tier 5 — Web & External

| Tool | Description | Source |
|------|-------------|--------|
| `webfetch` | Fetch any URL as markdown | opencode |
| `websearch` | Web search via multiple providers | opencode |
| `browser` | **Full Playwright**: headless Chromium, click, type, screenshot, console logs | omp + Cline |
| `localhost_view` | Inspect running local dev server — screenshot + DOM | Windsurf/Amp |
| `generate_image` | Generate images via Gemini image model | omp |
| `inspect_image` | Analyse images/screenshots with vision model | omp |

---

## Tier 6 — Agent Coordination

| Tool | Description | Source |
|------|-------------|--------|
| `task` | Spawn isolated parallel sub-agents with their own tool surface | opencode |
| `task_status` | Check status of running sub-agent tasks | opencode |
| `irc` | Inter-agent prose communication channel | omp |
| `plan` | Enter/exit plan mode — read-only deliberation before acting | opencode |
| `question` | Ask the user a structured follow-up question mid-task | opencode |
| `skill` | Load skill files (SKILL.md / AGENTS.md) into context | opencode |
| `todo_write` | Task list management with phase tracking | opencode |

---

## Tier 7 — Memory & Context

| Tool | Description | Source |
|------|-------------|--------|
| `checkpoint` | Mark conversation state for possible rewind | omp |
| `rewind` | Prune exploratory context back to a checkpoint | omp |
| `retain` | Queue durable facts to persist across sessions | omp |
| `recall` | Search the session memory bank | omp |
| `reflect` | Synthesise answers from retained memory | omp |
| `handoff` | Clean context transfer to a fresh agent instance (better than compaction) | Amp insight |

---

## Tier 8 — monkeyDcode Exclusives (nobody else has these)

| Tool | Description |
|------|-------------|
| `consistency_sample` | Multi-temperature candidate generation (the core innovation) |
| `verify_pipeline` | syntax → typecheck → lint → existing tests → generated tests → smoke |
| `model_probe` | Auto-detect model capability level (1–6) and adapt decomposition |
| `knowledge_graph` | AST-based code understanding — prevents hallucinated APIs |
| `vector_search` | Semantic code search across the project |

---

## Build Order

Tools are implemented in this order across the build steps:

| Step | Tools Built |
|------|-------------|
| Step 3 (Engine) | Tier 1 + Tier 2 + Tier 4 (from opencode) |
| Step 4 (Echo) | Validation only |
| Step 5 (Verification) | `verify_pipeline` |
| Step 6 (Consistency) | `consistency_sample`, `model_probe` |
| Step 7 (Agents) | `plan`, `task`, `task_status`, `question`, `todo_write` |
| Step 8 (Python Bridge) | `ast_edit`, `ast_grep`, `knowledge_graph`, `vector_search` |
| Step 9 (Context) | `retain`, `recall`, `reflect`, `checkpoint`, `rewind`, `handoff` |
| Step 10 (Review) | `debug`, `browser`, `localhost_view`, `github`, `generate_image`, `inspect_image` |
| Step 11 (TUI/Install) | `recipe`, `ssh`, `eval`, `job`, `calc`, `irc` |

---

## Total: 43 tools

Breakdown:
- From opencode: 17 tools
- From omp: 17 tools
- Amp-inspired: 1 (handoff)
- Windsurf/Amp-inspired: 1 (localhost_view)
- monkeyDcode exclusive: 5
- Playwright browser: 1 (upgrade over omp's Chromium)
- GitHub: 1

No other coding agent has more than 32 tools. We have 43.
