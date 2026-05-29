// EXPERIMENTAL: turns a task into a verifiable, decomposed plan. The
// decomposition granularity scales with the model's detected capability level.

import { readFile } from "node:fs/promises"
import { join } from "node:path"
import * as Capability from "@monkeydcode/consistency/model-capability/detector"
import { confine } from "@monkeydcode/core/util/fs-guard"
import { LLM } from "@monkeydcode/llm"
import { Effect } from "effect"
import { z } from "zod"
import { resolveModel } from "./model.ts"

const PROMPTS_DIR = join(import.meta.dir, "prompts")

const PlanStepSchema = z.object({
    description: z.string(),
    targetFiles: z.array(z.string()),
    changeType: z.enum(["create", "modify", "delete"]),
    dependencies: z.array(z.number()),
    verificationCriteria: z.string(),
})
const PlanStepsSchema = z.array(PlanStepSchema)

export type PlanStep = z.infer<typeof PlanStepSchema>

export interface Plan {
    steps: PlanStep[]
    decompositionLevel: number
}

export class PlanParseError extends Error {
    readonly _tag = "PlanParseError"
    constructor(message: string) {
        super(message)
        this.name = "PlanParseError"
    }
}

/** Read a prompt template, confined to the bundled prompts directory. */
export function loadPrompt(filename: string): Effect.Effect<string, PlanParseError> {
    return Effect.tryPromise({
        try: () => readFile(confine(PROMPTS_DIR, filename), "utf-8"),
        catch: (e) => new PlanParseError(`Failed to load prompt "${filename}": ${String(e)}`),
    })
}

function extractJsonArray(text: string): string | null {
    const fenced = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/)
    if (fenced) return fenced[1]!
    const start = text.indexOf("[")
    const end = text.lastIndexOf("]")
    if (start >= 0 && end > start) return text.slice(start, end + 1)
    return null
}

/** Parse + validate model output into PlanStep[]. Throws PlanParseError on bad output. */
export function parseStepsFromResponse(text: string): PlanStep[] {
    const json = extractJsonArray(text)
    if (!json) throw new PlanParseError("No JSON array found in model response")

    let parsed: unknown
    try {
        parsed = JSON.parse(json)
    } catch (e) {
        throw new PlanParseError(`Invalid JSON in model response: ${String(e)}`)
    }

    const result = PlanStepsSchema.safeParse(parsed)
    if (!result.success) {
        throw new PlanParseError(`Plan steps failed schema validation: ${result.error.message}`)
    }
    return result.data
}

export function plan(task: string, modelId: string) {
    return Effect.gen(function* () {
        const level = yield* Capability.detect(modelId)
        const promptTemplate = yield* loadPrompt(`plan-level-${level}.txt`)
        const prompt = promptTemplate.replace("{TASK}", task)

        const response = yield* LLM.generate({
            model: resolveModel(modelId),
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
        })

        const steps = yield* Effect.try({
            try: () => parseStepsFromResponse(response.text),
            catch: (e) => (e instanceof PlanParseError ? e : new PlanParseError(String(e))),
        })

        return { steps, decompositionLevel: level } satisfies Plan
    })
}
