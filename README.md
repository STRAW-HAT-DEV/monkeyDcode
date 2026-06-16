# monkeyDcode

CLI coding agent that produces consistent results across LLM sizes — from local Qwen 7B to Claude Opus.

## Features

- **Adaptive Plan Decomposition** — weak models get atomic steps, strong models get coarse tasks
- **Multi-Temperature Sampling** — generate N candidates, verify each, pick the best
- **Deterministic Verification** — syntax → typecheck → lint → tests → smoke
- **Specialist Sub-Agents** — bug-fix, feature, refactor, debug
- **Actor-Critic Review** — 3-round code review after every task

## Install

### Prerequisites

- [Bun](https://bun.sh) 1.3+
- [uv](https://docs.astral.sh/uv/) (Python tooling)
- [Ollama](https://ollama.com) (optional, for local models)

### Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/STRAW-HAT-DEV/monkeyDcode/main/scripts/install.sh | bash
```

### Manual install

```bash
git clone https://github.com/STRAW-HAT-DEV/monkeyDcode.git
cd monkeyDcode
bun install
./scripts/setup-python.sh
chmod +x bin/mdc
```

## Configure

Copy the default config:

```bash
mkdir -p ~/.config/monkeydcode
cp scripts/config.default.toml ~/.config/monkeydcode/config.toml
```

Edit `~/.config/monkeydcode/config.toml`:

```toml
[default]
model    = "qwen2.5-coder:7b"
provider = "ollama"

[verification]
stages = ["syntax", "typecheck", "lint", "tests"]

[context]
auto_compact_every = 5
```

## Use

```bash
# Interactive TUI
bun run dev
# or
./bin/mdc

# One-shot task
./bin/mdc "Add pagination to the users API"
```

## Development

```bash
bun install
bun run typecheck
bun run test
bun run bench               # benchmarks with consistency engine (needs Ollama + models)
bun run bench:baseline      # A/B without consistency engine
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
