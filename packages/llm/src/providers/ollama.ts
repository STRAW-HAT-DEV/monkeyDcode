// Ollama runs locally and speaks the OpenAI-compatible API.
// Default port: 11434. No real API key needed.

import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { openAIChat } from "../protocols/openai-chat.ts"
import { LLMRuntime } from "../runtime.ts"

const DEFAULT_OLLAMA = "http://localhost:11434/v1"

export const ollama = Route.make("ollama", {
    protocol: openAIChat,
    baseUrl: DEFAULT_OLLAMA,
    apiKey: () => LLMRuntime.getApiKey("ollama", () => "ollama"),
})

export function ollamaBaseUrl(): string {
    return LLMRuntime.getBaseUrl("ollama", DEFAULT_OLLAMA)
}

RouteRegistry.register(ollama)
