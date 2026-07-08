import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { makeOpenAIHandler } from "../handlers/openai-sdk.ts"
import { openAIChat } from "../protocols/openai-chat.ts"
import { LLMRuntime } from "../runtime.ts"

export const openai = Route.make("openai", {
    handler: makeOpenAIHandler(),
    baseUrl: "https://api.openai.com/v1",
    apiKey: () => LLMRuntime.getApiKey("openai", () => process.env["OPENAI_API_KEY"]),
})

RouteRegistry.register(openai)
