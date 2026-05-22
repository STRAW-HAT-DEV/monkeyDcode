// OpenRouter: one API key, access to Qwen, DeepSeek, Llama, Claude, GPT, and more.
// Recommended for testing weak models without running them locally.

import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { openAIChat } from "../protocols/openai-chat.ts"

export const openrouter = Route.make("openrouter", {
    protocol: openAIChat,
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: () => process.env["OPENROUTER_API_KEY"],
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/monkeydcode",
        "X-Title": "monkeyDcode",
    },
})

RouteRegistry.register(openrouter)
