import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import * as Capability from "@monkeydcode/consistency/model-capability/detector"
import { resolveModel } from "./utils.ts"
import { readFile } from "fs/promises"
import { join } from "path"
import { fileURLToPath } from "url"

const PROMPTS_DIR = join(fileURLToPath(import.meta.url), "../prompts")

export interface PlanStep {
    description: string
    targetFiles: string[]
    changeType: "create" | "modify" | "delete"
    dependencies: number[]
    verificationCriteria: string
}

export interface Plan {
    steps: PlanStep[]
    decompositionLevel: number
}

export function plan(task: string, modelId: string): Effect.Effect<Plan, unknown> {
    return Effect.gen(function* () {
        const level = yield* Capability.detect(modelId)
        const promptTemplate = yield* loadPrompt(`plan-level-${level}.txt`)
        const filledPrompt = promptTemplate.replace("{TASK}", task)

        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model: resolveModel(modelId),
                messages: [{ role: "user", content: filledPrompt }],
            })
        )

        const steps = parseStepsFromResponse(response.text)
        return { steps, decompositionLevel: level }
    })
}

function loadPrompt(filename: string): Effect.Effect<string, unknown> {
    return Effect.tryPromise(async () => {
        try {
            return await readFile(join(PROMPTS_DIR, filename), "utf-8")
        } catch {
            return readFile(join(PROMPTS_DIR, "plan-level-6.txt"), "utf-8")
        }
    })
}

function parseStepsFromResponse(text: string): PlanStep[] {
    try {
        const jsonMatch = text.match(/```json\n([\s\S]*?)```/)
        if (jsonMatch?.[1]) return JSON.parse(jsonMatch[1]) as PlanStep[]
    } catch {}
    return [{
        description: text.trim(),
        targetFiles: [],
        changeType: "modify",
        dependencies: [],
        verificationCriteria: "Code compiles and tests pass",
    }]
}
