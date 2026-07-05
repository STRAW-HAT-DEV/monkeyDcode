# monkeyDcode

CLI coding agent that produces consistent results across LLM sizes — from local Qwen 7B to Claude Opus.

## Features

- **Adaptive Plan Decomposition** — weak models get atomic steps, strong models get coarse tasks
- **Multi-Temperature Sampling** — generate N candidates, verify each, pick the best
- **Deterministic Verification** — syntax → typecheck → lint → tests → smoke
- **Specialist Sub-Agents** — bug-fix, feature, refactor, debug
- **Actor-Critic Review** — 3-round code review after every task

## Install

Use the full OS guide:

- [INSTALLATION.md](./INSTALLATION.md)

Quick path:

- **Windows:** `.\scripts\install.ps1`
- **macOS/Linux:** `curl -fsSL https://raw.githubusercontent.com/STRAW-HAT-DEV/monkeyDcode/main/scripts/install.sh | bash`

Then run:

```bash
mdc
```

First run opens the setup wizard for provider + API key + model.

## Use

```bash
# Interactive (global command)
mdc

# One-shot task
mdc "Add pagination to the users API"
```

## Development

```bash
bun install
bun run typecheck
bun run test
bun run bench               # full agent (consistency engine on)
bun run bench:baseline      # one-shot with prompt engineering, no sampling/voting
bun run bench:raw           # the floor — same model, zero scaffolding (run this first; other modes report uplift against it)
bun run bench:verify-only   # offline — validates expected benchmark solutions
bun run bench:compare       # compare two benchmark result JSON files

# Echo mode (session processor only, no orchestrator):
MDCODE_ECHO=1 bun run dev
```

## Architecture

```
mdc → TUI → Orchestrator → Plan/Build Agents → Consistency Engine → Verification Pipeline
                    ↓
              Python Bridge (tree-sitter, vector store, knowledge graph)
```

## License

See [LICENSE](LICENSE).
