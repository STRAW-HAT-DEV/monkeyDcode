# Step 4: Echo Milestone

**Goal:** Prove the foundation works by getting a simple "echo agent" running end-to-end.

**This is your first validation checkpoint.** Do not move past this step until the echo agent works.

**Prerequisites:** Steps 1-3 complete.

---

## What the Echo Agent Does

1. User types a message in the TUI
2. Message goes to the session processor
3. Processor calls the LLM
4. LLM responds
5. Response is displayed in the TUI

No agents, no plans, no tools. Just: input -> LLM -> output.

## 4.1 Update the TUI to capture input

Replace `packages/tui/src/index.tsx`:

```tsx
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { useState } from "react"

function App() {
    const [input, setInput] = useState("")
    const [messages, setMessages] = useState<string[]>([])

    const submit = async () => {
        const userMsg = input
        setMessages(prev => [...prev, `> ${userMsg}`])
        setInput("")
        const response = await callLLM(userMsg)
        setMessages(prev => [...prev, response])
    }

    return (
        <box flexDirection="column" padding={1}>
            <box flexDirection="column" flexGrow={1}>
                {messages.map((m, i) => <text key={i}>{m}</text>)}
            </box>
            <box>
                <text>{"> "}</text>
                <input value={input} onChange={setInput} onSubmit={submit} />
            </box>
        </box>
    )
}

async function callLLM(prompt: string): Promise<string> {
    return "echo: " + prompt   // wire this next
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
```

## 4.2 Wire up the actual LLM call

```typescript
import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import { ollama } from "@monkeydcode/llm/providers/ollama"

async function callLLM(prompt: string): Promise<string> {
    const program = Effect.gen(function* () {
        const response = yield* LLM.generate({
            model: ollama.model("qwen2.5-coder:7b"),
            prompt
        })
        return response.text
    })
    return await Effect.runPromise(program)
}
```

Add to `packages/tui/package.json` dependencies:
```json
"@monkeydcode/llm": "workspace:*"
```

Run `bun install` from repo root.

## 4.3 Wire up the session layer

The clean version uses the session processor:

```typescript
import { Session } from "@monkeydcode/engine"

async function callLLM(prompt: string): Promise<string> {
    const program = Effect.gen(function* () {
        const session = yield* Session.create({ projectRoot: process.cwd() })
        yield* Session.appendMessage(session.id, { role: "user", content: prompt })
        const response = yield* Session.process(session.id, {
            model: ollama.model("qwen2.5-coder:7b")
        })
        return response.text
    })
    return await Effect.runPromise(program)
}
```

Add `@monkeydcode/engine` to TUI deps and `bun install`.

## 4.4 Run it

```bash
ollama serve  # in another terminal
bun run dev
```

Type something. Qwen 7B responds.

## 4.5 Validation Checklist

- [ ] TUI accepts input
- [ ] Input reaches the session processor
- [ ] Session calls the LLM
- [ ] Response persists to SQLite
- [ ] Response renders in the TUI
- [ ] Multi-turn conversation works (each turn appends to session)

Verify SQLite:
```bash
sqlite3 ~/.local/share/monkeydcode/sessions.db "SELECT * FROM messages LIMIT 5;"
```

## 4.6 Commit

```bash
git add -A
git commit -m "feat: echo agent milestone

End-to-end TUI -> session -> LLM -> response works."
```

## What This Proves

You now have:
- Working LLM abstraction (swappable providers)
- Working session processor (message history)
- Working storage (SQLite persistence)
- Working TUI (input + output rendering)
- Working Effect runtime tying it all together

This is the foundation for the consistency engine.

## Next Step

[Step 5: Build the verification pipeline](05-verification-pipeline.md)
