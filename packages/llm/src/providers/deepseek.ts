import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { openAIChat } from "../protocols/openai-chat.ts"

export const deepseek = Route.make("deepseek", {
    protocol: openAIChat,
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: () => process.env["DEEPSEEK_API_KEY"],
})

RouteRegistry.register(deepseek)
