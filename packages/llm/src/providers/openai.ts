import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { makeOpenAIHandler } from "../handlers/openai-sdk.ts"

export const openai = Route.make("openai", {
    handler: makeOpenAIHandler(),
    baseUrl: "https://api.openai.com/v1",
    apiKey: () => process.env["OPENAI_API_KEY"],
})

RouteRegistry.register(openai)
