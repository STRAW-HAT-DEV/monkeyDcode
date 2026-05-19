# Step 6: Build the Consistency Engine

**Goal:** The core innovation. Multi-temperature sampling + RRP grading.

**Prerequisites:** [Step 5](05-verification-pipeline.md) complete.

**Reference spec:** [consistency-engine.md](consistency-engine.md)

---

## 6.1 Model capability registry

`packages/consistency/src/model-capability/registry.ts`:
```typescript
export type CapabilityLevel = 1 | 2 | 3 | 4 | 5 | 6

export const KNOWN_MODELS: Record<string, CapabilityLevel> = {
    // Level 1: Frontier
    "claude-opus-4": 1, "claude-opus-4-7": 1,
    "gpt-4o": 1, "gemini-2.5-pro": 1,

    // Level 2: Strong
    "claude-sonnet-4": 2, "claude-sonnet-4-6": 2,
    "gpt-4o-mini": 2, "deepseek-v3": 2,

    // Level 3: Medium
    "qwen2.5-coder:72b": 3, "qwen2.5-coder:32b": 3,
    "llama-3.3-70b": 3, "mistral-large": 3,

    // Level 4
    "deepseek-coder:33b": 4,

    // Level 5
    "qwen2.5-coder:14b": 5, "codellama:13b": 5,

    // Level 6
    "qwen2.5-coder:7b": 6, "deepseek-coder:6.7b": 6, "codellama:7b": 6,
}

export function lookup(modelId: string): CapabilityLevel | null {
    return KNOWN_MODELS[modelId] ?? null
}
```

## 6.2 Capability detector

`packages/consistency/src/model-capability/detector.ts`:
```typescript
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
```

## 6.3 Calibration benchmark

`packages/consistency/src/model-capability/benchmark.ts`:
```typescript
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
```

## 6.4 The sampler

`packages/consistency/src/sampler.ts`:
```typescript
import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import * as Pipeline from "./verification/pipeline.ts"
import * as Capability from "./model-capability/detector.ts"
import * as Grader from "./grader.ts"

const TEMP_SETS: Record<number, number[]> = {
    1: [0.3], 2: [0.3],
    3: [0.3, 0.5], 4: [0.3, 0.5],
    5: [0.3, 0.4, 0.5, 0.6], 6: [0.3, 0.4, 0.5, 0.6],
}

export function sample(task: SamplingTask, retries = 0): Effect.Effect<SamplingResult> {
    return Effect.gen(function* () {
        const level = yield* Capability.detect(task.modelId)
        const temps = TEMP_SETS[level]!

        const candidates = yield* Effect.all(
            temps.map(t => generateCandidate(task, t)),
            { concurrency: "unbounded" }
        )

        const verified = yield* Effect.all(
            candidates.map(c => verifyCandidate(c, task.files)),
            { concurrency: "unbounded" }
        )

        const passing = verified.filter(c => c.verification.passed)

        if (passing.length === 0) {
            if (retries >= 3) {
                const best = verified.sort((a, b) => b.verification.score - a.verification.score)[0]
                return { selected: best!, confidence: 0 }
            }
            const errors = verified.flatMap(v => v.verification.errors)
            const newPrompt = task.prompt + "\n\nPrevious failed:\n" + JSON.stringify(errors)
            return yield* sample({ ...task, prompt: newPrompt }, retries + 1)
        }

        const graded = Grader.gradeAll(passing)
        const selected = graded.sort((a, b) => b.rrpScore - a.rrpScore)[0]!
        return { selected, confidence: selected.rrpScore }
    })
}
```

## 6.5 The RRP grader

`packages/consistency/src/grader.ts`:
```typescript
import { distance } from "fastest-levenshtein"

export function gradeAll(candidates: any[]) {
    return candidates.map(c => grade(c, candidates))
}

function grade(candidate: any, all: any[]) {
    const verificationScore = candidate.verification.score
    const consistencyScore = computeConsistency(candidate, all)
    const qualityScore = computeQuality(candidate.change)

    const rrpScore = 0.5 * verificationScore +
                     0.3 * consistencyScore +
                     0.2 * qualityScore

    return { ...candidate, consistencyScore, qualityScore, rrpScore }
}

function computeConsistency(candidate: any, all: any[]): number {
    if (all.length === 1) return 1.0
    const distances = all
        .filter(c => c !== candidate)
        .map(c => normalizedDistance(candidate.change, c.change))
    const avg = distances.reduce((s, d) => s + d, 0) / distances.length
    return 1.0 - avg
}

function normalizedDistance(a: string, b: string): number {
    return Math.min(distance(a, b) / Math.max(a.length, b.length, 1), 1.0)
}

function computeQuality(change: string): number {
    let score = 1.0
    if (change.includes("console.log")) score -= 0.2
    if (change.match(/\b\d{4,}\b/)) score -= 0.1
    if (!change.includes(":")) score -= 0.1
    return Math.max(0, score)
}
```

Install: `bun add fastest-levenshtein` in `packages/consistency/`.

## 6.6 Test

`packages/consistency/test/sampler.test.ts`:
```typescript
test("samples N candidates for weak model", async () => {
    const result = await Effect.runPromise(Sampler.sample({
        prompt: "Write a TS function that reverses a string",
        files: ["/tmp/reverse.ts"],
        model: ollama.model("qwen2.5-coder:7b"),
        modelId: "qwen2.5-coder:7b"
    }))
    expect(result.selected).toBeDefined()
    expect(result.confidence).toBeGreaterThan(0)
})
```

## 6.7 Commit

```bash
git add -A
git commit -m "feat: consistency engine

- Multi-temperature sampler with adaptive candidate count
- RRP grader (verification + consistency + quality)
- Model capability detector (static + dynamic probing)"
```

## Validation Checklist

- [ ] Known models -> instant lookup
- [ ] Unknown models -> benchmark probe
- [ ] Probe results cached
- [ ] Sampler generates correct candidate count per level
- [ ] Parallel verification
- [ ] Failed candidates trigger retry (max 3)
- [ ] RRP grading selects best

## Next Step

[Step 7: Plan + Build agents](07-plan-build-agents.md)
