import { Route } from "./route.ts"
import { RouteRegistry } from "./route-registry.ts"
import { openAIChat } from "./protocols/openai-chat.ts"
import { LLMRuntime } from "./runtime.ts"

/** Register a user-defined OpenAI-compatible API (LM Studio, vLLM, etc.). */
export function registerOpenAICompatibleProvider(
    providerId: string,
    baseUrl: string,
    apiKey: string,
): void {
    const normalized = baseUrl.replace(/\/$/, "")
    LLMRuntime.set(providerId, { apiKey, baseUrl: normalized })
    RouteRegistry.register(
        Route.make(providerId, {
            protocol: openAIChat,
            baseUrl: normalized,
            apiKey: () => LLMRuntime.getApiKey(providerId, () => apiKey),
        }),
    )
}
