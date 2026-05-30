import { ollama } from "@monkeydcode/llm/providers/ollama"
import { anthropic } from "@monkeydcode/llm/providers/anthropic"
import type { ModelRef } from "@monkeydcode/llm"

export function resolveModel(modelId: string): ModelRef {
    if (modelId.startsWith("claude-")) return anthropic.model(modelId)
    if (modelId.includes(":")) return ollama.model(modelId)
    return ollama.model(modelId)
}
