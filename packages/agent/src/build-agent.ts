// EXPERIMENTAL: executes a plan step-by-step. Runs steps in declared order; no
// dependency topo-sort yet. Each step retrieves context, samples a verified
// change from the model, and applies it under a path-traversal guard.

import { writeFile } from "node:fs/promises"
import * as Sampler from "@monkeydcode/consistency/sampler"
import * as Retriever from "@monkeydcode/context/retriever"
import type { AssembledContext } from "@monkeydcode/context/retriever"
import * as WorkingMemory from "@monkeydcode/context/working-memory"
import { confine } from "@monkeydcode/core/util/fs-guard"
import { Effect } from "effect"
import { resolveModel } from "./model.ts"
import type { Plan, PlanStep } from "./plan-agent.ts"

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
            description: step.description,
        })

        const prompt = buildExecutionPrompt(step, context)

        const result = yield* Sampler.sample({
            prompt,
            files: step.targetFiles,
            model: resolveModel(modelId),
            modelId,
        })

        yield* applyChange(result.selected.change, step.targetFiles)

        yield* WorkingMemory.update({
            completedSteps: [
                ...context.workingMemory.completedSteps,
                { index, confidence: result.confidence, timestamp: new Date().toISOString() },
            ],
        })
    })
}

export function buildExecutionPrompt(step: PlanStep, context: AssembledContext): string {
    return `${Retriever.formatForPrompt(context)}

## Task
${step.description}

Target files: ${step.targetFiles.join(", ")}
Change type: ${step.changeType}
Verification: ${step.verificationCriteria}

Generate the code change.`.trim()
}

/**
 * Write a generated change to its target file, refusing any path that escapes
 * the project root. Returns the absolute path written, or null when no target.
 */
export function applyChange(
    change: string,
    targetFiles: string[],
    root: string = process.cwd(),
): Effect.Effect<string | null> {
    return Effect.tryPromise(async () => {
        const target = targetFiles[0]
        if (!target) return null
        const safe = confine(root, target) // throws PathConfinementError on traversal
        await writeFile(safe, change)
        return safe
    }).pipe(Effect.orDie)
}
