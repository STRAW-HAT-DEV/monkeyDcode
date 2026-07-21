// Resolves the user's already-configured model for the ACP agent's prompt
// handler. Deliberately duplicated from @monkeydcode/mcp-server's identical
// model.ts (same ~15-line shape) rather than shared: both are stdio-server
// entry points whose stdin IS the JSON-RPC transport, so both share the same
// hard constraint — never fall back to the interactive setup wizard, which
// reads real stdin and would corrupt the protocol stream. A shared package
// for something this small would add more coupling than the duplication costs.

import { loadConfig } from "@monkeydcode/core/mdc-config"
import { isModelConfigured } from "@monkeydcode/core/model-setup"
import { bootstrapLLM, resolveModel } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"

let cached: Promise<{ model: ModelRef; modelId: string }> | null = null

export function resolveConfiguredModel(): Promise<{ model: ModelRef; modelId: string }> {
    if (!cached) {
        cached = (async () => {
            const config = await loadConfig()
            if (!isModelConfigured(config)) {
                throw new Error(
                    'No model configured. Run "mdc setup" once in a terminal (this ACP agent cannot run the interactive wizard).',
                )
            }
            await bootstrapLLM(config)
            const model = resolveModel(config.provider, config.model)
            return { model, modelId: config.model }
        })().catch(err => {
            cached = null
            throw err
        })
    }
    return cached
}
