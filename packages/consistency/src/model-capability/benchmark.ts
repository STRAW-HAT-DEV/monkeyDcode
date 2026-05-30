import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import * as Pipeline from "../verification/pipeline.ts"
import type { CapabilityLevel } from "./registry.ts"
import { writeFile } from "fs/promises"

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

export function runBenchmark(model: ModelRef): Effect.Effect<CapabilityLevel, unknown> {
    return Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{ role: "user", content: PROBE_TASK }],
            })
        )

        const code = extractCode(response.text)
        yield* Effect.promise(() => Promise.all([
            writeFile("/tmp/mdc-probe.ts", code),
            writeFile("/tmp/mdc-probe.test.ts", PROBE_TESTS),
        ]))

        const result = yield* Effect.promise(() =>
            Pipeline.run(["/tmp/mdc-probe.ts", "/tmp/mdc-probe.test.ts"], "/tmp")
        )

        if (result.score >= 0.95) return 1 as CapabilityLevel
        if (result.score >= 0.85) return 2 as CapabilityLevel
        if (result.score >= 0.70) return 3 as CapabilityLevel
        if (result.score >= 0.50) return 4 as CapabilityLevel
        if (result.score >= 0.30) return 5 as CapabilityLevel
        return 6 as CapabilityLevel
    })
}

function extractCode(text: string): string {
    const match = text.match(/```(?:typescript|ts)?\n([\s\S]*?)```/)
    return match?.[1] ?? text
}
