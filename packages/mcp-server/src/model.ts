// Resolves the user's already-configured model for tool handlers.
//
// Deliberately does NOT fall back to the interactive setup wizard: this
// process's stdin is the MCP JSON-RPC transport, not a terminal — running
// @clack/prompts against it would corrupt the protocol stream (and hang,
// since nothing will ever type into it). If nothing is configured yet, tools
// fail fast with an actionable message instead.

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
                    'No model configured. Run "mdc setup" once in a terminal (this MCP server cannot run the interactive wizard).',
                )
            }
            await bootstrapLLM(config)
            const model = resolveModel(config.provider, config.model)
            return { model, modelId: config.model }
        })().catch(err => {
            cached = null // let the next call retry instead of caching a permanent failure
            throw err
        })
    }
    return cached
}
