import type { ModelRef } from "./schema.ts"
import { RouteRegistry } from "./route-registry.ts"

/** Build a ModelRef for the configured provider + model id. */
export function resolveModel(provider: string, modelId: string): ModelRef {
    const route = RouteRegistry.get(provider)
    if (!route) {
        throw new Error(
            `Unknown provider "${provider}". Run setup or register a custom OpenAI-compatible provider.`,
        )
    }
    return route.model(modelId)
}
