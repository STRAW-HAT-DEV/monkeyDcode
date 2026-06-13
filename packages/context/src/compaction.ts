import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { loadConfig } from "@monkeydcode/core/mdc-config"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import { anthropic } from "@monkeydcode/llm/providers/anthropic"

function resolveModel(modelId: string): ModelRef {
    if (modelId.startsWith("claude-")) return anthropic.model(modelId)
    return ollama.model(modelId)
}

interface Message {
    role: string
    content: string
}

function formatMessages(messages: Message[]): string {
    return messages.map(m => `${m.role}: ${m.content}`).join("\n")
}

export async function shouldCompact(messageCount: number): Promise<boolean> {
    const cfg = await loadConfig()
    const every = cfg.context.autoCompactEvery
    return messageCount > 0 && messageCount % every === 0
}

export function compact(messages: Message[], modelId?: string) {
    return Effect.gen(function* () {
        const cfg = yield* Effect.promise(() => loadConfig())
        const model: ModelRef = modelId ? resolveModel(modelId) : resolveModel(cfg.model)
        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{
                    role: "user",
                    content: `Summarize this conversation concisely, preserving all key decisions and context:\n\n${formatMessages(messages)}`,
                }],
                temperature: 0.3,
            }),
        )
        return [{ role: "system", content: `[Conversation Summary] ${response.text}` }] as Message[]
    })
}
