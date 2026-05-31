import { Effect } from "effect"
import type { ModelRef } from "@monkeydcode/llm"
import { $ } from "bun"
import * as Pipeline from "@monkeydcode/consistency/verification/pipeline"
import * as PlanAgent from "../plan-agent.ts"
import * as BuildAgent from "../build-agent.ts"

export function refactor(target: string, goal: string, model: ModelRef, modelId: string): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        const projectRoot = process.cwd()

        // Step 1 — Snapshot existing test results before touching anything
        const before = yield* Effect.promise(() =>
            Pipeline.run([target], projectRoot)
        )

        // Step 2 — Plan the refactor (read-only understanding first)
        const plan = yield* PlanAgent.plan(
            `Refactor ${target} to achieve: ${goal}

CRITICAL CONSTRAINTS:
- Do NOT change observable behavior
- All existing tests must pass after refactor
- Keep the same public API/interface
- Only restructure internals

Current verification score: ${(before.score * 100).toFixed(0)}%`,
            modelId,
        )

        // Step 3 — Execute the refactor
        yield* BuildAgent.executePlan(plan, modelId)

        // Step 4 — Verify behavior is preserved
        const after = yield* Effect.promise(() =>
            Pipeline.run([target], projectRoot)
        )

        if (!after.passed) {
            // Refactor broke something — surface the errors
            yield* Effect.fail(new Error(
                `Refactor broke existing behavior:\n${Pipeline.formatErrors(after)}`
            ))
        }
    })
}
