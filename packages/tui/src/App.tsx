import { useState, useEffect } from "react"
import { Effect } from "effect"
import { Runner } from "@monkeydcode/engine/session/runner"
import { logUserToEngine, logAssistantToEngine, processWithEngine } from "./engine-session.ts"
import { handle as orchestrate } from "@monkeydcode/agent/orchestrator"
import { subscribe as subscribeStatus } from "@monkeydcode/agent/status"
import type { AgentStatus } from "@monkeydcode/agent/status"
import type { Plan } from "@monkeydcode/agent/plan-agent"
import { shouldCompact, compact } from "@monkeydcode/context/compaction"
import type { ModelRef } from "@monkeydcode/llm"
import type { MdcConfig } from "@monkeydcode/core/mdc-config"
import { AgentStatus as AgentStatusView } from "./components/AgentStatus.tsx"
import { ProgressBar } from "./components/ProgressBar.tsx"
import { DiffView } from "./components/DiffView.tsx"
import { PlanView } from "./components/PlanView.tsx"
import { handleSlashCommand } from "./slash-commands.ts"

interface Message {
    role: "user" | "assistant" | "system"
    content: string
}

export interface AppProps {
    config: MdcConfig
    model: ModelRef
    modelId: string
    runnerSessionId: string
    engineSessionId: string
    echoMode?: boolean
}

export function App({ config, model, modelId, runnerSessionId, engineSessionId, echoMode = false }: AppProps) {
    const [input, setInput] = useState("")
    const [messages, setMessages] = useState<Message[]>([])
    const [status, setStatus] = useState<AgentStatus>({ agent: "idle", action: "Ready — type your task" })
    const [plan, setPlan] = useState<Plan | null>(null)
    const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
    const [diff, setDiff] = useState("")
    const [busy, setBusy] = useState(false)
    const [messageCount, setMessageCount] = useState(0)

    useEffect(() => {
        return subscribeStatus((s) => {
            setStatus(s)
            if (s.plan !== undefined) setPlan(s.plan ?? null)
            if (s.progress) setProgress(s.progress)
            if (s.diff) setDiff(s.diff)
        })
    }, [])

    const submit = async () => {
        const text = input.trim()
        if (!text || busy) return

        setInput("")

        if (text.startsWith("/")) {
            const slash = handleSlashCommand(text, {
                provider: model.provider,
                modelId: model.id,
            })
            if (!slash.handled) return

            if (slash.exit) {
                process.exit(0)
            }
            if (slash.message === "__CLEAR__") {
                setMessages([])
                setPlan(null)
                setDiff("")
                setStatus({ agent: "idle", action: "Ready — type your task" })
                return
            }
            if (slash.message) {
                setMessages(prev => [...prev, { role: "system", content: slash.message! }])
            }
            return
        }

        setBusy(true)
        setMessages(prev => [...prev, { role: "user", content: text }])
        setMessageCount(c => c + 1)

        Runner.logMessage(runnerSessionId, "user", text)
        await logUserToEngine(process.cwd(), engineSessionId, text, model)

        if (await shouldCompact(messageCount + 1)) {
            const history = Runner.getHistory(runnerSessionId).map(m => ({
                role: m.role,
                content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            }))
            const compacted = await Effect.runPromise(compact(history, model))
            const summary = compacted[0]?.content ?? ""
            Runner.logMessage(runnerSessionId, "system", summary)
            setMessages(prev => [...prev, { role: "system", content: summary }])
        }

        try {
            const reply = echoMode
                ? await processWithEngine(process.cwd(), engineSessionId, text, model)
                : await (async () => {
                    await Effect.runPromise(orchestrate(text, model, modelId))
                    return plan
                        ? `Completed plan with ${plan.steps.length} steps.`
                        : "Task completed."
                })()
            setMessages(prev => [...prev, { role: "assistant", content: reply }])
            Runner.logMessage(runnerSessionId, "assistant", reply)
            await logAssistantToEngine(process.cwd(), engineSessionId, reply)
        } catch (e) {
            const err = e instanceof Error ? e.message : String(e)
            setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err}` }])
        } finally {
            setBusy(false)
            setProgress(null)
        }
    }

    return (
        <box flexDirection="column" padding={1} width="100%" height="100%">
            <box flexDirection="column" marginBottom={1}>
                <text>monkeyDcode</text>
                <text>model: {model.provider}/{model.id} · /help for commands</text>
            </box>

            <AgentStatusView status={status} />

            {plan && <PlanView plan={plan} />}
            {progress && progress.total > 0 && <ProgressBar current={progress.current} total={progress.total} />}
            {diff && <DiffView diff={diff} />}

            <box flexDirection="column" flexGrow={1} marginTop={1} marginBottom={1}>
                {messages.map((m, i) => (
                    <text key={i}>{m.role}: {m.content}</text>
                ))}
            </box>

            <box flexDirection="row">
                <text>{"> "}</text>
                <input
                    value={input}
                    focused={!busy}
                    onChange={setInput}
                    onSubmit={submit}
                    placeholder={busy ? "Working..." : "Task or /help"}
                />
            </box>
        </box>
    )
}
