// EXPERIMENTAL: resolves a model's capability level (1=frontier … 6=weak).
// Known models are looked up statically; unknown models are benchmarked once
// and memoized in-process.

import type { LLMError } from "@monkeydcode/llm"
import { Effect } from "effect"
import { runBenchmark } from "./benchmark.ts"
import { type CapabilityLevel, lookup } from "./registry.ts"

// In-memory cache for the lifetime of the process. (A persisted cache is on the
// roadmap; the previous Storage.kvGet/kvSet API never existed.)
const cache = new Map<string, CapabilityLevel>()

export function detect(modelId: string): Effect.Effect<CapabilityLevel, LLMError> {
    return Effect.gen(function* () {
        const known = lookup(modelId)
        if (known !== null) return known

        const cached = cache.get(modelId)
        if (cached !== undefined) return cached

        const level = yield* runBenchmark(modelId)
        cache.set(modelId, level)
        return level
    })
}

/** Clear the in-memory capability cache (test seam). */
export function resetCache(): void {
    cache.clear()
}
