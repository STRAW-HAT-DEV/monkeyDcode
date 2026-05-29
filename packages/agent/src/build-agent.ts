import { Effect } from "effect"
import * as Sampler from "@monkeydcode/consistency/sampler"
import * as WorkingMemory from "@monkeydcode/context/working-memory"
import * as Retriever from "@monkeydcode/context/retriever"

export function executePlan(plan: Plan, modelId: string) {
    return Effect.gen(function* () {
        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i]!
            yield* executeStep(step, modelId, i)
        }
    })
}

function executeStep(step: PlanStep, modelId: string, index: number) {
    return Effect.gen(function* () {
        const context = yield* Retriever.retrieve({
            files: step.targetFiles,
            description: step.description
        })

        const prompt = buildExecutionPrompt(step, context)

        const result = yield* Sampler.sample({
            prompt,
            files: step.targetFiles,
            model: resolveModel(modelId),
            modelId
        })

        yield* applyChange(result.selected.change, step.targetFiles)

        yield* WorkingMemory.update({
            completedStep: index,
            confidence: result.confidence
        })
    })
}

const context = yield* Retriever.retrieve({
    files: step.targetFiles,
    description: step.description
})

const prompt = `
${Retriever.formatForPrompt(context)}

## Task
${step.description}

Generate the code change.
`
