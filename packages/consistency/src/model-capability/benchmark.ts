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

export function runBenchmark(modelId: string) {
    return Effect.gen(function* () {
        const response = yield* LLM.generate({
            model: resolveModel(modelId),
            prompt: PROBE_TASK,
            generation: { temperature: 0.3 }
        })

        const code = extractCode(response.text)
        yield* writeFiles({ "/tmp/probe.ts": code, "/tmp/probe.test.ts": PROBE_TESTS })

        const result = yield* Pipeline.run(["/tmp/probe.ts", "/tmp/probe.test.ts"])

        // Score -> capability level
        if (result.score >= 0.95) return 1
        if (result.score >= 0.85) return 2
        if (result.score >= 0.70) return 3
        if (result.score >= 0.50) return 4
        if (result.score >= 0.30) return 5
        return 6
    })
}
