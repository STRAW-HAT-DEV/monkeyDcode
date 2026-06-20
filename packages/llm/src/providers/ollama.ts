// Ollama runs locally and speaks the OpenAI-compatible API.
// Default port: 11434. No real API key needed — "ollama" is used as a dummy value.

import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { makeOpenAICompatHandler } from "../handlers/openai-compat-sdk.ts"
import { LLMRuntime } from "../runtime.ts"

const DEFAULT_OLLAMA = "http://localhost:11434/v1"

export const ollama = Route.make("ollama", {
    handler: makeOpenAICompatHandler("ollama", DEFAULT_OLLAMA, "ollama"),
    baseUrl: DEFAULT_OLLAMA,
    apiKey: () => LLMRuntime.getApiKey("ollama", () => "ollama"),
})

export function ollamaBaseUrl(): string {
    return LLMRuntime.getBaseUrl("ollama", DEFAULT_OLLAMA)
}

RouteRegistry.register(ollama)
