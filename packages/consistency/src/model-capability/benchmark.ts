// EXPERIMENTAL: probes an unknown model's coding ability by asking it to
// implement a small function, then scoring the result through the verification
// pipeline in an isolated temp directory.

import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { withTempDir } from "@monkeydcode/core/util/tmp"
import { LLM, ollama } from "@monkeydcode/llm"
import type { LLMError } from "@monkeydcode/llm"
import { Effect } from "effect"
import { DEFAULT_CONFIG } from "../verification/config.ts"
import * as Pipeline from "../verification/pipeline.ts"
import type { CapabilityLevel } from "./registry.ts"

const PROBE_TASK = `Implement:
export function parseCSV(input: string): Record<string, string>[]

Parse CSV with headers in first line. Handle quoted fields containing commas.`

const PROBE_TESTS = `
import { test, expect } from "bun:test"
import { parseCSV } from "./probe.ts"

test("basic", () => {
    expect(parseCSV("name,age\\nAlice,30")).toEqual([{ name: "Alice", age: "30" }])
})

test("quoted", () => {
    expect(parseCSV('n,b\\nA,"x,y"')).toEqual([{ n: "A", b: "x,y" }])
})`

function extractCode(text: string): string {
    const fenced = text.match(/```(?:[a-zA-Z]+)?\s*([\s\S]*?)```/)
    return fenced ? fenced[1]!.trim() : text.trim()
}

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
    for (const [name, content] of Object.entries(files)) {
        await writeFile(join(dir, name), content)
    }
}

export function runBenchmark(modelId: string): Effect.Effect<CapabilityLevel, LLMError> {
    return Effect.gen(function* () {
        const response = yield* LLM.generate({
            model: ollama.model(modelId),
            messages: [{ role: "user", content: PROBE_TASK }],
            temperature: 0.3,
        })

        const code = extractCode(response.text)

        const result = yield* Effect.promise(() =>
            withTempDir(async (dir) => {
                await writeFiles(dir, { "probe.ts": code, "probe.test.ts": PROBE_TESTS })
                return Pipeline.run([join(dir, "probe.ts"), join(dir, "probe.test.ts")], dir, DEFAULT_CONFIG)
            }, "mdc-probe-"),
        )

        // Score → capability level.
        if (result.score >= 0.95) return 1
        if (result.score >= 0.85) return 2
        if (result.score >= 0.7) return 3
        if (result.score >= 0.5) return 4
        if (result.score >= 0.3) return 5
        return 6
    })
}
