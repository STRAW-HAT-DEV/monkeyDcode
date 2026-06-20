import { Route } from "../route.ts"
import { RouteRegistry } from "../route-registry.ts"
import { makeOpenAICompatHandler } from "../handlers/openai-compat-sdk.ts"

export const groq = Route.make("groq", {
    handler: makeOpenAICompatHandler("groq", "https://api.groq.com/openai/v1"),
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: () => process.env["GROQ_API_KEY"],
})

RouteRegistry.register(groq)
