import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { openAIChat } from "../protocols/openai-chat.ts"

export const openai = Route.make("openai", {
    protocol: openAIChat,
    baseUrl: "https://api.openai.com/v1",
    apiKey: () => process.env["OPENAI_API_KEY"],
})

RouteRegistry.register(openai)
