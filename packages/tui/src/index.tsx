import { createCliRenderer, TextAttributes } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { useState } from "react"
import { Runner } from "@monkeydcode/engine/session/runner"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import type { ModelRef } from "@monkeydcode/llm"

// ─── Session bootstrap ───────────────────────────────────────────────────────
// Change model here to switch providers. Ollama runs locally with no API key.
// Anthropic, OpenRouter require env vars: ANTHROPIC_API_KEY, OPENROUTER_API_KEY
const MODEL: ModelRef = ollama.model("qwen2.5-coder:7b")
const session = Runner.createSession(process.cwd())

// ─── Types ───────────────────────────────────────────────────────────────────
interface ChatMessage {
    role: "user" | "assistant" | "error"
    text: string
}

// ─── App ─────────────────────────────────────────────────────────────────────
function App() {
    const [input, setInput] = useState("")
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [thinking, setThinking] = useState(false)
    const [streamedText, setStreamedText] = useState("")

    const submit = async () => {
        if (!input.trim() || thinking) return

        const userText = input.trim()
        setInput("")
        setMessages((prev) => [...prev, { role: "user", text: userText }])
        setThinking(true)
        setStreamedText("")

        try {
            let full = ""

            // Use streaming so tokens appear as they arrive
            for await (const delta of Runner.streamChat(session.id, userText, MODEL)) {
                full += delta
                setStreamedText(full)
            }

            setStreamedText("")
            setMessages((prev) => [...prev, { role: "assistant", text: full }])
        } catch (e) {
            setStreamedText("")
            setMessages((prev) => [
                ...prev,
                { role: "error", text: `Error: ${e instanceof Error ? e.message : String(e)}` },
            ])
        } finally {
            setThinking(false)
        }
    }

    return (
        <box flexDirection="column" flexGrow={1}>

            {/* ── Header ── */}
            <box padding={1}>
                <ascii-font font="tiny" text="monkeyDcode" />
            </box>
            <box paddingLeft={1} paddingBottom={1}>
                <text attributes={TextAttributes.DIM}>
                    {MODEL.provider}/{MODEL.id} · session {session.id.slice(0, 8)}
                </text>
            </box>

            {/* ── Message list ── */}
            <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={2}>
                {messages.length === 0 && !thinking && (
                    <text attributes={TextAttributes.DIM}>
                        Type a message and press Enter to start...
                    </text>
                )}

                {messages.map((m, i) => (
                    <box key={i} flexDirection="column" paddingBottom={1}>
                        <text
                            attributes={
                                m.role === "user"
                                    ? TextAttributes.BOLD
                                    : m.role === "error"
                                      ? TextAttributes.BOLD
                                      : TextAttributes.DIM
                            }
                        >
                            {m.role === "user" ? "you" : m.role === "error" ? "error" : "assistant"}
                        </text>
                        <text>{m.text}</text>
                    </box>
                ))}

                {/* Live streaming output */}
                {thinking && streamedText !== "" && (
                    <box flexDirection="column" paddingBottom={1}>
                        <text attributes={TextAttributes.DIM}>assistant</text>
                        <text>{streamedText}</text>
                    </box>
                )}

                {/* Spinner while waiting for first token */}
                {thinking && streamedText === "" && (
                    <text attributes={TextAttributes.DIM}>thinking...</text>
                )}
            </box>

            {/* ── Input bar ── */}
            <box paddingLeft={1} paddingRight={1} paddingBottom={1}>
                <text attributes={TextAttributes.DIM}>{thinking ? "  " : "> "}</text>
                <input
                    value={input}
                    onChange={setInput}
                    onSubmit={submit}
                />
            </box>

        </box>
    )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
