import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { loadConfig } from "@monkeydcode/core/mdc-config"
import { resolveModel } from "@monkeydcode/llm/resolve-model"

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

export function compact(messages: Message[], model?: ModelRef) {
    return Effect.gen(function* () {
        const cfg = yield* Effect.promise(() => loadConfig())
        const resolved: ModelRef =
            model ?? resolveModel(cfg.provider, cfg.model)
        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model: resolved,
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
