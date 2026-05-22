// Global registry mapping provider name → Route.
// Providers register themselves on import (side-effect import pattern).
// Dependency Inversion: LLM layer depends on this abstraction, not concrete providers.

import type { Route } from "./route.ts"

const registry = new Map<string, Route>()

export const RouteRegistry = {
    register(route: Route): void {
        registry.set(route.provider, route)
    },

    get(provider: string): Route | undefined {
        return registry.get(provider)
    },

    list(): string[] {
        return [...registry.keys()]
    },
}
