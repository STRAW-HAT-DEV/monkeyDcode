# Step 11: TUI Polish and Installation

**Goal:** Usable TUI + installation scripts.

**Prerequisites:** [Step 10](10-review-subagents.md) complete.

---

## 11.1 TUI components

`packages/tui/src/components/AgentStatus.tsx`:
```tsx
import { useState, useEffect } from "react"
import { Bus } from "@monkeydcode/engine"

export function AgentStatus() {
    const [status, setStatus] = useState({ agent: "idle", action: "" })
    useEffect(() => {
        const unsub = Bus.subscribe("agent.status", setStatus)
        return unsub
    }, [])
    return (
        <box borderStyle="single" padding={1}>
            <text>Agent: {status.agent}</text>
            <text>{status.action}</text>
        </box>
    )
}
```

`packages/tui/src/components/ProgressBar.tsx`:
```tsx
export function ProgressBar({ current, total }: { current: number; total: number }) {
    const pct = Math.round((current / total) * 100)
    const filled = "X".repeat(Math.round(pct / 5))
    const empty = "-".repeat(20 - filled.length)
    return <text>[{filled}{empty}] {pct}% ({current}/{total})</text>
}
```

`packages/tui/src/components/DiffView.tsx`:
```tsx
export function DiffView({ diff }: { diff: string }) {
    return (
        <box flexDirection="column">
            {diff.split("\n").map((line, i) => {
                const color = line.startsWith("+") ? "green" :
                              line.startsWith("-") ? "red" : "white"
                return <text key={i} color={color}>{line}</text>
            })}
        </box>
    )
}
```

`packages/tui/src/components/PlanView.tsx`:
```tsx
export function PlanView({ plan }: { plan: Plan }) {
    return (
        <box flexDirection="column" padding={1}>
            <text bold>Plan ({plan.steps.length} steps, level {plan.decompositionLevel})</text>
            {plan.steps.map((step, i) => (
                <box key={i}>
                    <text>{i + 1}. {step.description}</text>
                    <text dim>   -> {step.targetFiles.join(", ")}</text>
                </box>
            ))}
        </box>
    )
}
```

## 11.2 Main TUI layout

`packages/tui/src/index.tsx`:
```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { useState } from "react"
import { Orchestrator } from "@monkeydcode/agent"
import { AgentStatus, ProgressBar, DiffView, PlanView } from "./components"

function App() {
    const [input, setInput] = useState("")
    const [messages, setMessages] = useState<Message[]>([])
    const [currentPlan, setCurrentPlan] = useState<Plan | null>(null)
    const [currentDiff, setCurrentDiff] = useState("")
    const [progress, setProgress] = useState({ current: 0, total: 0 })

    const submit = async () => {
        const userMsg = input
        setMessages(prev => [...prev, { role: "user", content: userMsg }])
        setInput("")
        await Orchestrator.handle(userMsg)
    }

    return (
        <box flexDirection="column" padding={1}>
            <AgentStatus />
            {currentPlan && <PlanView plan={currentPlan} />}
            {progress.total > 0 && <ProgressBar current={progress.current} total={progress.total} />}
            {currentDiff && <DiffView diff={currentDiff} />}

            <box flexDirection="column" flexGrow={1}>
                {messages.map((m, i) => <text key={i}>{m.role}: {m.content}</text>)}
            </box>

            <box>
                <text>{"> "}</text>
                <input value={input} onChange={setInput} onSubmit={submit} />
            </box>
        </box>
    )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
```

## 11.3 Config file

`~/.config/monkeydcode/config.toml`:
```toml
[default]
model = "qwen2.5-coder:14b"
provider = "ollama"

[providers.ollama]
base_url = "http://localhost:11434/v1"

[providers.openrouter]
api_key_env = "OPENROUTER_API_KEY"

[providers.anthropic]
api_key_env = "ANTHROPIC_API_KEY"

[verification]
stages = ["syntax", "typecheck", "lint", "tests"]
test_timeout = 120

[consistency]
max_retries = 3

[context]
auto_compact_every = 5
```

## 11.4 CLI entry point

`bin/mdc`:
```bash
#!/usr/bin/env bun
import "/path/to/packages/tui/src/index.tsx"
```

`chmod +x bin/mdc`.

## 11.5 Installation scripts

`scripts/install.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${MONKEYDCODE_HOME:-$HOME/.monkeydcode}"
echo "Installing monkeyDcode to $INSTALL_DIR..."

command -v bun >/dev/null || { echo "Bun required"; exit 1; }
command -v uv >/dev/null || { echo "uv required"; exit 1; }

if [ -d "$INSTALL_DIR/.git" ]; then
    git -C "$INSTALL_DIR" pull
else
    git clone https://github.com/<user>/monkeyDcode "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
bun install
./scripts/setup-python.sh

ln -sf "$INSTALL_DIR/bin/mdc" /usr/local/bin/mdc
echo "Installed. Run 'mdc' to start."
```

`scripts/setup-python.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${MONKEYDCODE_HOME:-$(pwd)}"
cd "$INSTALL_DIR/tools"

echo "Setting up Python tooling..."
uv venv
uv sync

echo "Python tooling ready."
```

## 11.6 User-facing README

`README.md`:
```markdown
# monkeyDcode

CLI coding agent. Works equally well with any LLM — frontier or small.

## Install
\`\`\`bash
curl -fsSL https://raw.githubusercontent.com/<user>/monkeyDcode/main/scripts/install.sh | bash
\`\`\`

## Configure
Edit ~/.config/monkeydcode/config.toml

## Use
\`\`\`bash
mdc                              # interactive
mdc "Add pagination to users API"
\`\`\`
```

## 11.7 Commit

```bash
git add -A
git commit -m "feat: TUI polish and installation"
```

## Validation Checklist

- [ ] TUI shows agent status in real-time
- [ ] Progress bar updates
- [ ] Diff view colors correctly
- [ ] Plan view shows steps
- [ ] Config loads correctly
- [ ] `mdc` works from anywhere

## Next Step

[Step 12: Benchmarking](12-benchmarking.md)
