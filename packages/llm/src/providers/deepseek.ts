import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { makeOpenAICompatHandler } from "../handlers/openai-compat-sdk.ts"
import { openAIChat } from "../protocols/openai-chat.ts"
import { LLMRuntime } from "../runtime.ts"

export const deepseek = Route.make("deepseek", {
    handler: makeOpenAICompatHandler("deepseek", "https://api.deepseek.com/v1"),
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: () => LLMRuntime.getApiKey("deepseek", () => process.env["DEEPSEEK_API_KEY"]),
})

RouteRegistry.register(deepseek)
