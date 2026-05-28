import { Effect } from "effect"
import { Storage } from "@monkeydcode/engine"
import { lookup, type CapabilityLevel } from "./registry.ts"
import { runBenchmark } from "./benchmark.ts"

export function detect(modelId: string): Effect.Effect<CapabilityLevel> {
    return Effect.gen(function* () {
        const known = lookup(modelId)
        if (known !== null) return known

        const cached = yield* Storage.kvGet(`capability:${modelId}`)
        if (cached) return cached as CapabilityLevel

        const level = yield* runBenchmark(modelId)
        yield* Storage.kvSet(`capability:${modelId}`, level)
        return level
    })
}
