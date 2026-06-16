import { ensureModelConfigured } from "@monkeydcode/core/model-setup"
import { bootstrapLLM, resolveModel } from "@monkeydcode/llm"
import type { MdcConfig } from "@monkeydcode/core/mdc-config"
import type { ModelRef } from "@monkeydcode/llm"

export async function loadTuiConfig(): Promise<{ config: MdcConfig; model: ModelRef; modelId: string }> {
    const config = await ensureModelConfigured()
    await bootstrapLLM(config)
    const model = resolveModel(config.provider, config.model)
    return { config, model, modelId: config.model }
}
