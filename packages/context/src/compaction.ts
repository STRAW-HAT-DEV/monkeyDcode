import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import { ollama } from "@monkeydcode/llm/providers/ollama"

interface Message {
    role: string
    content: string
}

const defaultModel = ollama.model("qwen2.5-coder:7b")

function formatMessages(messages: Message[]): string {
    return messages.map(m => `${m.role}: ${m.content}`).join("\n")
}

export function shouldCompact(messageCount: number): boolean {
    return messageCount > 0 && messageCount % 50 === 0
}

export function compact(messages: Message[]) {
    return Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model: defaultModel,
                messages: [
                    {
                        role: "user",
                        content: `Summarize this conversation concisely, preserving all key decisions and context:\n\n${formatMessages(messages)}`,
                    },
                ],
            })
        )
        return [{ role: "system", content: `[Conversation Summary] ${response.text}` }] as Message[]
    })
}
