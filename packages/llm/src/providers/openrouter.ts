// OpenRouter: one API key, access to Qwen, DeepSeek, Llama, Claude, GPT, and more.
// Recommended for testing weak models without running them locally.

import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { makeOpenAICompatHandler } from "../handlers/openai-compat-sdk.ts"
import { openAIChat } from "../protocols/openai-chat.ts"
import { LLMRuntime } from "../runtime.ts"

const OPENROUTER_HEADERS = {
    "HTTP-Referer": "https://github.com/monkeydcode",
    "X-Title": "monkeyDcode",
}

export const openrouter = Route.make("openrouter", {
    handler: makeOpenAICompatHandler("openrouter", "https://openrouter.ai/api/v1", undefined, {
        defaultHeaders: OPENROUTER_HEADERS,
    }),
    protocol: openAIChat,
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: () => LLMRuntime.getApiKey("openrouter", () => process.env["OPENROUTER_API_KEY"]),
    defaultHeaders: OPENROUTER_HEADERS,
})

RouteRegistry.register(openrouter)
