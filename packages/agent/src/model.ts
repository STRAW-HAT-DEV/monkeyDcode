// EXPERIMENTAL: shared model resolution for the plan/build agents.
// Defaults every modelId to the local Ollama route, matching the working TUI
// path. Multi-provider routing keyed by modelId is on the roadmap.

import { ollama } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"

export function resolveModel(modelId: string): ModelRef {
    return ollama.model(modelId)
}
