import { Effect } from "effect"
import { lookup, type CapabilityLevel, KNOWN_MODELS } from "./registry.ts"
import { runBenchmark } from "./benchmark.ts"
import { readFile, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import { anthropic } from "@monkeydcode/llm/providers/anthropic"
import type { ModelRef } from "@monkeydcode/llm"

const CACHE_FILE = join(process.cwd(), ".monkeydcode", "capability-cache.json")

async function readCache(): Promise<Record<string, CapabilityLevel>> {
    try { return JSON.parse(await readFile(CACHE_FILE, "utf-8")) } catch { return {} }
}

async function writeCache(cache: Record<string, CapabilityLevel>) {
    await mkdir(join(process.cwd(), ".monkeydcode"), { recursive: true })
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2))
}

function modelRefFromId(modelId: string): ModelRef {
    if (modelId.startsWith("claude-")) return anthropic.model(modelId)
    if (modelId.includes(":")) return ollama.model(modelId)
    return ollama.model(modelId)
}

export function detect(modelId: string): Effect.Effect<CapabilityLevel, unknown> {
    return Effect.gen(function* () {
        const known = lookup(modelId)
        if (known !== null) return known

        const cache = yield* Effect.tryPromise(() => readCache())
        if (cache[modelId]) return cache[modelId]!

        const model = modelRefFromId(modelId)
        const level = yield* runBenchmark(model)
        yield* Effect.tryPromise(() => writeCache({ ...cache, [modelId]: level }))
        return level
    })
}
