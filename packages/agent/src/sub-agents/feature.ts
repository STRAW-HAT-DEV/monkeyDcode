import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import type { Plan } from "../plan-agent.ts"
import * as PlanAgent from "../plan-agent.ts"
import * as BuildAgent from "../build-agent.ts"

export function build(spec: string, model: ModelRef, modelId: string): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        // Step 1 — Clarify the spec to make it concrete and unambiguous
        const clarifiedSpec = yield* clarify(spec, model)

        // Step 2 — Plan the feature in steps
        const plan = yield* PlanAgent.plan(clarifiedSpec, model, modelId)

        // Step 3 — Execute: scaffold first, then implement
        const { scaffold, implementation } = splitPlan(plan)

        if (scaffold.steps.length > 0) {
            yield* BuildAgent.executePlan(scaffold, model, modelId)
        }
        yield* BuildAgent.executePlan(implementation, model, modelId)

        // Step 4 — Write tests for the new feature
        const testPlan = yield* PlanAgent.plan(
            `Write comprehensive tests for this feature:\n${clarifiedSpec}\n\nTests must cover: happy path, edge cases, error handling.`,
            model,
            modelId,
        )
        yield* BuildAgent.executePlan(testPlan, model, modelId)
    })
}

function clarify(spec: string, model: ModelRef): Effect.Effect<string, unknown> {
    return Effect.promise(() =>
        LLM.generateAsync({
            model,
            messages: [{
                role: "user",
                content: `You are clarifying a feature request for implementation.

Feature request: ${spec}

Rewrite this as a precise, unambiguous implementation spec that includes:
1. What the feature does (behavior)
2. What inputs it accepts and what it returns
3. Error cases to handle
4. How it integrates with existing code (be specific about interfaces)

Output ONLY the clarified spec. No preamble.`,
            }],
        }).then(r => r.text)
    )
}

function splitPlan(plan: Plan): { scaffold: Plan; implementation: Plan } {
    const scaffoldTypes = ["create"]
    const scaffold = {
        ...plan,
        steps: plan.steps.filter(s => scaffoldTypes.includes(s.changeType)),
    }
    const implementation = {
        ...plan,
        steps: plan.steps.filter(s => !scaffoldTypes.includes(s.changeType)),
    }
    return { scaffold, implementation }
}
