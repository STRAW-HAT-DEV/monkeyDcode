import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { anthropicMessages } from "../protocols/anthropic-messages.ts"

export const anthropic = Route.make("anthropic", {
    protocol: anthropicMessages,
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: () => process.env["ANTHROPIC_API_KEY"],
})

RouteRegistry.register(anthropic)
