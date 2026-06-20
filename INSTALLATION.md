# monkeyDcode Installation & Setup Guide

`mdc` is the global CLI command for monkeyDcode (similar to how `claude` launches Claude Code).

## Start Here (3 Steps)

### Step 1: Install prerequisites

Install these first on your OS:

- [Bun](https://bun.sh) (required)
- [Git](https://git-scm.com) (required)
- Python 3 + [uv](https://docs.astral.sh/uv/) (optional, for Python bridge features)

### Step 2: Install monkeyDcode

Pick your OS and run exactly one of these:

#### Windows (PowerShell)

```powershell
git clone https://github.com/STRAW-HAT-DEV/monkeyDcode.git
cd monkeyDcode
.\scripts\install.ps1
```

#### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/STRAW-HAT-DEV/monkeyDcode/main/scripts/install.sh | bash
```

### Step 3: Start and configure

```bash
mdc
```

On first launch, wizard asks for:

1. Provider
2. API key (if needed)
3. Model ID

---

## Prerequisites (All OS)

Required:

- [Bun](https://bun.sh) (1.3+ recommended)
- [Git](https://git-scm.com)

Optional (for Python bridge features):

- Python 3
- [uv](https://docs.astral.sh/uv/)

Notes:

- You do **not** need Ollama unless you want local models.
- Cloud providers (OpenRouter, Groq, Anthropic, OpenAI, DeepSeek) work with API keys.

---

## Install on Windows

### Option A (Recommended: clone + PowerShell installer)

```powershell
git clone https://github.com/STRAW-HAT-DEV/monkeyDcode.git
cd monkeyDcode
.\scripts\install.ps1
```

What this does:

1. Checks Bun and Git
2. Runs `bun install`
3. Optionally sets up Python bridge (if Python is installed)
4. Creates global wrappers:
   - `mdc.cmd`
   - `monkeydcode.cmd`
5. Adds `%USERPROFILE%\.local\bin` to your user PATH (if needed)

Open a new terminal, then run:

```powershell
mdc
```

### Option B (Install from another location)

```powershell
.\scripts\install.ps1 -InstallDir "$env:USERPROFILE\.monkeydcode"
```

---

## Install on macOS / Linux

### Option A (Recommended: one-liner)

```bash
curl -fsSL https://raw.githubusercontent.com/STRAW-HAT-DEV/monkeyDcode/main/scripts/install.sh | bash
```

What this does:

1. Checks Bun and Git
2. Clones/updates repo at `~/.monkeydcode` (or `$MONKEYDCODE_HOME`)
3. Runs `bun install`
4. Optionally runs Python bridge setup
5. Links global commands:
   - `mdc`
   - `monkeydcode`

### Option B (Manual clone + local installer)

```bash
git clone https://github.com/STRAW-HAT-DEV/monkeyDcode.git
cd monkeyDcode
bash scripts/install.sh
```

If your shell cannot find `mdc`, add this to your shell profile:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then restart terminal.

---

## First Run Setup (All OS)

Run:

```bash
mdc
```

On first run, monkeyDcode opens an interactive setup wizard. It asks for:

1. Provider (Ollama / OpenRouter / Groq / Anthropic / OpenAI / DeepSeek / Custom)
2. API key (if needed)
3. Model ID

It saves config and credentials to:

- **Windows:** `%APPDATA%\monkeydcode\`
- **macOS/Linux:** `~/.config/monkeydcode/`

Files:

- `config.toml` (provider + model + behavior settings)
- `credentials.json` (API keys / base URLs)

---

## Reconfigure Later

Use:

```bash
mdc setup
```

Or force setup on next launch:

```bash
MDCODE_RECONFIGURE=1 mdc
```

---

## Basic Usage

Interactive mode:

```bash
mdc
```

One-shot mode:

```bash
mdc "Add pagination to the users API"
```

Diagnostics:

```bash
mdc doctor
```

Version:

```bash
mdc version
```

---

## In-App Slash Commands

Inside interactive mode:

- `/help` - show help
- `/model` - show active provider/model
- `/setup` - setup instructions
- `/clear` - clear chat
- `/quit` or `/exit` - close app

---

## Environment Variables

- `MDCODE_RECONFIGURE=1` - force setup wizard on next launch
- `MDCODE_SKIP_SETUP=1` - skip setup (useful in CI)
- `MDCODE_ECHO=1` - run echo mode (session processor path)

---

## Troubleshooting

### `mdc: command not found`

- Restart terminal.
- Ensure PATH includes:
  - Windows: `%USERPROFILE%\.local\bin`
  - macOS/Linux: `~/.local/bin`

### Bun not found

Install from [bun.sh](https://bun.sh), then rerun installer.

### Python bridge warnings

Install Python + uv, then run:

```bash
scripts/setup-python.sh
```

### Want local models?

Install Ollama and pull a model:

```bash
ollama pull qwen2.5-coder:7b
```

Then run `mdc setup` and select Ollama.

