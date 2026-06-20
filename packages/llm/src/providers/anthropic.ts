import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { makeAnthropicHandler } from "../handlers/anthropic-sdk.ts"
import { LLMRuntime } from "../runtime.ts"

export const anthropic = Route.make("anthropic", {
    handler: makeAnthropicHandler(),
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: () => LLMRuntime.getApiKey("anthropic", () => process.env["ANTHROPIC_API_KEY"]),
})

RouteRegistry.register(anthropic)
