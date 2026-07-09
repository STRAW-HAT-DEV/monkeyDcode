import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { makeOpenAICompatHandler } from "../handlers/openai-compat-sdk.ts"
import { openAIChat } from "../protocols/openai-chat.ts"
import { LLMRuntime } from "../runtime.ts"

export const groq = Route.make("groq", {
    handler: makeOpenAICompatHandler("groq", "https://api.groq.com/openai/v1"),
    protocol: openAIChat,
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: () => LLMRuntime.getApiKey("groq", () => process.env["GROQ_API_KEY"]),
})

RouteRegistry.register(groq)
