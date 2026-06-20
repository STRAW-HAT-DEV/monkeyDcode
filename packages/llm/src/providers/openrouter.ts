// OpenRouter: one API key, access to Qwen, DeepSeek, Llama, Claude, GPT, and more.
// Recommended for testing weak models without running them locally.

import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { makeOpenAICompatHandler } from "../handlers/openai-compat-sdk.ts"

const OPENROUTER_HEADERS = {
    "HTTP-Referer": "https://github.com/monkeydcode",
    "X-Title": "monkeyDcode",
}
import { openAIChat } from "../protocols/openai-chat.ts"
import { LLMRuntime } from "../runtime.ts"

export const openrouter = Route.make("openrouter", {
    handler: makeOpenAICompatHandler("openrouter", "https://openrouter.ai/api/v1", undefined, {
        defaultHeaders: OPENROUTER_HEADERS,
    }),
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: () => process.env["OPENROUTER_API_KEY"],
    defaultHeaders: OPENROUTER_HEADERS,
    apiKey: () => LLMRuntime.getApiKey("openrouter", () => process.env["OPENROUTER_API_KEY"]),
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/monkeydcode",
        "X-Title": "monkeyDcode",
    },
})

RouteRegistry.register(openrouter)
