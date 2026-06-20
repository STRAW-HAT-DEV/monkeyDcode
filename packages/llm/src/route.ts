// A Route binds a Protocol (or SDK handler) to a base URL + auth.
// Open/Closed Principle: adding a new provider = new Route.make() call, nothing else changes.

import type { Protocol } from "./protocol.ts"
import type { ModelRef } from "./schema.ts"
import type { LLMHandler } from "./handler.ts"

export type { LLMHandler }

export interface RouteConfig {
    readonly protocol?: Protocol           // legacy raw-fetch (kept for compat)
    readonly handler?: LLMHandler          // SDK-based (preferred when present)
    readonly baseUrl: string
    readonly apiKey: () => string | undefined
    readonly defaultHeaders?: Record<string, string>
}

export interface Route {
    readonly provider: string
    readonly config: RouteConfig
    model(id: string, label?: string): ModelRef
}

export const Route = {
    make: (provider: string, config: RouteConfig): Route => ({
        provider,
        config,
        model: (id, label) => ({ provider, id, label }),
    }),
}

// Compatibility types for opencode engine session layer
export interface LLMClient {
    send(request: import("./schema.ts").LLMRequest): Promise<import("./schema.ts").LLMResponse>
}

export interface RequestExecutor {
    execute(request: unknown): Promise<unknown>
}

export interface WebSocketExecutor {
    connect(url: string): Promise<unknown>
}

export interface LLMClientService {
    client: LLMClient
}
