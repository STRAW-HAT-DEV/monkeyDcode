# Step 0: Prerequisites

Install these before you start. Skip any you already have.

## Required

### Bun (TypeScript runtime + package manager)
```bash
curl -fsSL https://bun.sh/install | bash
exec $SHELL
bun --version  # should print 1.3+
```

### uv (Python package manager)
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
exec $SHELL
uv --version  # should print 0.5+
```

### Python 3.14+
```bash
uv python install 3.14
uv python list  # confirm 3.14 is available
```

### GitHub CLI (for forking opencode)
```bash
# Fedora
sudo dnf install gh

# Ubuntu/Debian
sudo apt install gh

# macOS
brew install gh

gh auth login
gh auth status
```

## Recommended

### Ollama (for local LLM testing)

You need this to test monkeyDcode with weak models — the whole point of this project.

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama --version

# Pull a small coder model to test with later
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5-coder:14b
```

### SQLite (usually pre-installed)
```bash
sqlite3 --version
# If missing: sudo dnf install sqlite
```

## API Keys (for testing with hosted models)

Have these ready (configure later in `~/.config/monkeydcode/config.toml`):

- `OPENAI_API_KEY` (optional)
- `ANTHROPIC_API_KEY` (optional)
- `OPENROUTER_API_KEY` (optional — gives access to many models cheaply)

**Tip**: OpenRouter is recommended for testing — one API key, access to Qwen, DeepSeek, Llama, Claude, GPT.

## Verify Everything

```bash
bun --version    # 1.3+
uv --version     # 0.5+
gh auth status   # logged in
ollama list      # qwen2.5-coder:7b appears
```

If all four print successfully, proceed to [Step 1](01-fork-and-scaffold.md).
