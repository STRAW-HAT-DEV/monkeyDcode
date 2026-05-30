import { Effect } from "effect"
import { writeFile } from "fs/promises"
import * as Sampler from "@monkeydcode/consistency/sampler"
import * as Retriever from "@monkeydcode/context/retriever"
import type { Plan, PlanStep } from "./plan-agent.ts"
import { resolveModel } from "./utils.ts"
import * as WorkingMemory from "./working-memory.ts"

export type { Plan, PlanStep }

export function executePlan(plan: Plan, modelId: string): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i]!
            yield* executeStep(step, modelId, i)
        }
    })
}

function executeStep(step: PlanStep, modelId: string, index: number): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        const context = yield* Retriever.retrieve({
            files: step.targetFiles,
            description: step.description,
        })

        const prompt = buildExecutionPrompt(step, context)
        const model = resolveModel(modelId)

        const result = yield* Sampler.sample({
            prompt,
            files: step.targetFiles,
            model,
            modelId,
        })

        yield* applyChange(result.selected.change, step.targetFiles)

        yield* WorkingMemory.update({
            completedSteps: [{ index, confidence: result.confidence, timestamp: new Date().toISOString() }],
        })
    })
}

function buildExecutionPrompt(step: PlanStep, context: Retriever.AssembledContext): string {
    return `${Retriever.formatForPrompt(context)}

## Task
${step.description}

## Target Files
${step.targetFiles.join("\n")}

## Verification Criteria
${step.verificationCriteria}

Generate the complete code change needed.`
}

function applyChange(change: string, targetFiles: string[]): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        const codeBlock = change.match(/```(?:\w+)?\n([\s\S]*?)```/)
        const code = codeBlock?.[1] ?? change
        if (targetFiles[0]) {
            yield* Effect.tryPromise(() => writeFile(targetFiles[0]!, code))
        }
    })
}
