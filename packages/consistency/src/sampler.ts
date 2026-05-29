// EXPERIMENTAL: multi-sample consistency engine. Generates several candidate
// changes at varied temperatures, verifies each in an isolated temp dir, grades
// the survivors, and selects the best. Not yet wired into the TUI.

import { writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { withTempDir } from "@monkeydcode/core/util/tmp"
import { LLM } from "@monkeydcode/llm"
import type { LLMError, ModelRef } from "@monkeydcode/llm"
import { Effect } from "effect"
import * as Grader from "./grader.ts"
import * as Capability from "./model-capability/detector.ts"
import * as Pipeline from "./verification/pipeline.ts"
import type { VerificationResult } from "./verification/types.ts"

const TEMP_SETS: Record<number, number[]> = {
    1: [0.3],
    2: [0.3],
    3: [0.3, 0.5],
    4: [0.3, 0.5],
    5: [0.3, 0.4, 0.5, 0.6],
    6: [0.3, 0.4, 0.5, 0.6],
}

const MAX_RETRIES = 3

export interface SamplingTask {
    prompt: string
    files: string[]
    model: ModelRef
    modelId: string
}

export interface UnverifiedCandidate {
    change: string
    temperature: number
}

export interface Candidate extends UnverifiedCandidate {
    verification: VerificationResult
}

export interface GradedCandidate extends Candidate {
    consistencyScore: number
    qualityScore: number
    rrpScore: number
}

export interface SamplingResult {
    selected: GradedCandidate
    confidence: number
}

export class SamplingError extends Error {
    readonly _tag = "SamplingError"
    constructor(message: string) {
        super(message)
        this.name = "SamplingError"
    }
}

/** Strip a markdown code fence, if present, returning the inner source. */
export function extractCode(text: string): string {
    const fenced = text.match(/```(?:[a-zA-Z]+)?\s*([\s\S]*?)```/)
    return fenced ? fenced[1]!.trim() : text.trim()
}

function generateCandidate(task: SamplingTask, temperature: number): Effect.Effect<UnverifiedCandidate, LLMError> {
    return LLM.generate({
        model: task.model,
        messages: [{ role: "user", content: task.prompt }],
        temperature,
    }).pipe(Effect.map((res) => ({ change: extractCode(res.text), temperature })))
}

function verifyCandidate(candidate: UnverifiedCandidate, files: string[]): Effect.Effect<Candidate> {
    return Effect.promise(async () => {
        const verification = await withTempDir(async (dir) => {
            const name = files[0] ? basename(files[0]) : "candidate.ts"
            const filePath = join(dir, name)
            await writeFile(filePath, candidate.change)
            return Pipeline.run([filePath], dir)
        }, "mdc-sample-")
        return { ...candidate, verification }
    })
}

export function sample(task: SamplingTask, retries = 0): Effect.Effect<SamplingResult, SamplingError | LLMError> {
    return Effect.gen(function* () {
        const level = yield* Capability.detect(task.modelId)
        const temps = TEMP_SETS[level] ?? [0.3]

        const unverified = yield* Effect.all(
            temps.map((t) => generateCandidate(task, t)),
            { concurrency: "unbounded" },
        )

        const verified = yield* Effect.all(
            unverified.map((c) => verifyCandidate(c, task.files)),
            { concurrency: "unbounded" },
        )

        const passing = verified.filter((c) => c.verification.passed)

        if (passing.length === 0) {
            if (retries >= MAX_RETRIES) {
                return yield* Effect.fail(
                    new SamplingError(`No candidate passed verification after ${MAX_RETRIES} retries`),
                )
            }
            const errors = verified.flatMap((v) => v.verification.errors)
            const newPrompt = `${task.prompt}\n\nPrevious attempts failed verification:\n${JSON.stringify(errors.slice(0, 20))}`
            return yield* sample({ ...task, prompt: newPrompt }, retries + 1)
        }

        const graded = Grader.gradeAll(passing)
        const selected = graded.sort((a, b) => b.rrpScore - a.rrpScore)[0]!
        return { selected, confidence: selected.rrpScore }
    })
}
