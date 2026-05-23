// Ollama runs locally and speaks the OpenAI-compatible API.
// Default port: 11434. No real API key needed.

import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { openAIChat } from "../protocols/openai-chat.ts"

export const ollama = Route.make("ollama", {
    protocol: openAIChat,
    baseUrl: "http://localhost:11434/v1",
    apiKey: () => "ollama",
})

RouteRegistry.register(ollama)
