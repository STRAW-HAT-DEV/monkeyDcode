import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import * as Pipeline from "./verification/pipeline.ts"
import type { VerificationResult } from "./verification/types.ts"
import * as Capability from "./model-capability/detector.ts"
import * as Grader from "./grader.ts"

export interface SamplingTask {
    prompt: string
    files: string[]
    model: ModelRef
    modelId: string
}

export interface Candidate {
    change: string
    temperature: number
    verification: VerificationResult
}

export interface SamplingResult {
    selected: Candidate & { rrpScore: number }
    confidence: number
}

const TEMP_SETS: Record<number, number[]> = {
    1: [0.3],
    2: [0.3],
    3: [0.3, 0.5],
    4: [0.3, 0.5],
    5: [0.3, 0.4, 0.5, 0.6],
    6: [0.3, 0.4, 0.5, 0.6],
}

export function sample(task: SamplingTask, retries = 0): Effect.Effect<SamplingResult, unknown> {
    return Effect.gen(function* () {
        const level = yield* Capability.detect(task.modelId)
        const temps = TEMP_SETS[level] ?? [0.5]

        const candidates = yield* Effect.all(
            temps.map(t => generateCandidate(task, t)),
            { concurrency: "unbounded" },
        )

        const verified = yield* Effect.all(
            candidates.map(c => verifyCandidate(c, task.files)),
            { concurrency: "unbounded" },
        )

        const passing = verified.filter(c => c.verification.passed)

        if (passing.length === 0) {
            if (retries >= 3) {
                const best = verified.sort((a, b) => b.verification.score - a.verification.score)[0]!
                return { selected: { ...best, rrpScore: 0 }, confidence: 0 }
            }
            const errors = verified.flatMap(v => v.verification.errors)
            const retryPrompt = task.prompt + "\n\nPrevious attempt failed:\n" + JSON.stringify(errors, null, 2)
            return yield* sample({ ...task, prompt: retryPrompt }, retries + 1)
        }

        const graded = Grader.gradeAll(passing)
        const selected = graded.sort((a, b) => b.rrpScore - a.rrpScore)[0]!
        return { selected, confidence: selected.rrpScore }
    })
}

function generateCandidate(task: SamplingTask, temperature: number): Effect.Effect<Candidate, unknown> {
    return Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model: task.model,
                messages: [{ role: "user", content: task.prompt }],
            })
        )
        return { change: response.text, temperature, verification: null as unknown as VerificationResult }
    })
}

function verifyCandidate(candidate: Candidate, files: string[]): Effect.Effect<Candidate, unknown> {
    return Effect.gen(function* () {
        const projectRoot = files[0] ? files[0].split("/").slice(0, -1).join("/") : process.cwd()
        const verification = yield* Effect.promise(() => Pipeline.run(files, projectRoot))
        return { ...candidate, verification }
    })
}
