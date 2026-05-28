import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import * as Capability from "@monkeydcode/consistency/model-capability/detector"

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

export function plan(task: string, modelId: string): Effect.Effect<Plan> {
    return Effect.gen(function* () {
        const level = yield* Capability.detect(modelId)
        const promptTemplate = yield* loadPrompt(`plan-level-${level}.txt`)
        const prompt = promptTemplate.replace("{TASK}", task)

        const response = yield* LLM.generate({
            model: resolveModel(modelId),
            prompt,
            generation: { temperature: 0.3 }
        })

        const steps = parseStepsFromResponse(response.text)
        return { steps, decompositionLevel: level }
    })
}
