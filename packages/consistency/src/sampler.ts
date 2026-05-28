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
