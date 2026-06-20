import { Effect } from "effect"
import { lookup, type CapabilityLevel, KNOWN_MODELS } from "./registry.ts"
import { runBenchmark } from "./benchmark.ts"
import { readFile, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import { anthropic } from "@monkeydcode/llm/providers/anthropic"
import type { ModelRef } from "@monkeydcode/llm"

const CACHE_FILE = join(process.cwd(), ".monkeydcode", "capability-cache.json")
const STATS_FILE = join(process.cwd(), ".monkeydcode", "capability-stats.json")

interface PassStats {
    attempts: number
    passes: number
}

async function readCache(): Promise<Record<string, CapabilityLevel>> {
    try { return JSON.parse(await readFile(CACHE_FILE, "utf-8")) } catch { return {} }
}

async function writeCache(cache: Record<string, CapabilityLevel>) {
    await mkdir(join(process.cwd(), ".monkeydcode"), { recursive: true })
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2))
}

async function readStats(): Promise<Record<string, PassStats>> {
    try { return JSON.parse(await readFile(STATS_FILE, "utf-8")) } catch { return {} }
}

async function writeStats(stats: Record<string, PassStats>) {
    await mkdir(join(process.cwd(), ".monkeydcode"), { recursive: true })
    await writeFile(STATS_FILE, JSON.stringify(stats, null, 2))
}

/** Tier 3: track pass rates and promote/demote levels over time. */
function adjustLevel(modelId: string, base: CapabilityLevel, stats: PassStats): CapabilityLevel {
    if (stats.attempts < 5) return base
    const rate = stats.passes / stats.attempts
    if (rate >= 0.85 && base > 1) return (base - 1) as CapabilityLevel
    if (rate <= 0.4 && base < 6) return (base + 1) as CapabilityLevel
    return base
}

export async function recordPassRate(modelId: string, passed: boolean): Promise<void> {
    const stats = await readStats()
    const cur = stats[modelId] ?? { attempts: 0, passes: 0 }
    cur.attempts++
    if (passed) cur.passes++
    stats[modelId] = cur
    await writeStats(stats)
}

/**
 * Legacy fallback when only a model id (no provider) is available. Prefer
 * passing a ModelRef so the configured provider is used instead of a guess.
 */
function modelRefFromId(modelId: string): ModelRef {
    if (modelId.startsWith("claude-")) return anthropic.model(modelId)
    return ollama.model(modelId)
}

/**
 * Detect a model's capability level. Accepts the resolved ModelRef (preferred,
 * so the correct provider is used for the benchmark probe) or a bare model id
 * (legacy; provider is guessed).
 */
export function detect(model: ModelRef | string): Effect.Effect<CapabilityLevel, unknown> {
    const modelRef = typeof model === "string" ? modelRefFromId(model) : model
    const modelId = modelRef.id
    return Effect.gen(function* () {
        const known = lookup(modelId)
        if (known !== null) {
            const stats = yield* Effect.tryPromise(() => readStats())
            return adjustLevel(modelId, known, stats[modelId] ?? { attempts: 0, passes: 0 })
        }

        const cache = yield* Effect.tryPromise(() => readCache())
        if (cache[modelId]) {
            const stats = yield* Effect.tryPromise(() => readStats())
            return adjustLevel(modelId, cache[modelId]!, stats[modelId] ?? { attempts: 0, passes: 0 })
        }

        const level = yield* runBenchmark(modelRef)
        yield* Effect.tryPromise(() => writeCache({ ...cache, [modelId]: level }))
        return level
    })
}

export { KNOWN_MODELS, lookup }
