import { loadConfig, type MdcConfig } from "@monkeydcode/core/mdc-config"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import { anthropic } from "@monkeydcode/llm/providers/anthropic"
import { openrouter } from "@monkeydcode/llm/providers/openrouter"
import type { ModelRef } from "@monkeydcode/llm"

export async function loadTuiConfig(): Promise<{ config: MdcConfig; model: ModelRef; modelId: string }> {
    const config = await loadConfig()
    const modelId = config.model
    let model: ModelRef

    switch (config.provider) {
        case "anthropic":
            model = anthropic.model(modelId)
            break
        case "openrouter":
            model = openrouter.model(modelId)
            break
        default:
            model = ollama.model(modelId)
    }

    return { config, model, modelId }
}
