import { Effect } from "effect"
import type { ModelRef } from "@monkeydcode/llm"
import { treeSitter } from "@monkeydcode/python-bridge"
import * as Pipeline from "@monkeydcode/consistency/verification/pipeline"
import * as PlanAgent from "../plan-agent.ts"
import * as BuildAgent from "../build-agent.ts"
import { assertCanWrite } from "../registry.ts"

export function refactor(target: string, goal: string, model: ModelRef, modelId: string): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        assertCanWrite("refactor")
        const projectRoot = process.cwd()

        // Step 1 — Parse AST structure before planning (plan/agents.md)
        const ast = yield* Effect.tryPromise(() => treeSitter.parseAST(target))
        const astSummary = JSON.stringify(ast).slice(0, 2000)

        const before = yield* Effect.promise(() =>
            Pipeline.run([target], projectRoot)
        )

        const plan = yield* PlanAgent.plan(
            `Refactor ${target} to achieve: ${goal}

AST structure (tree-sitter):
${astSummary}

CRITICAL CONSTRAINTS:
- Do NOT change observable behavior
- All existing tests must pass after refactor
- Keep the same public API/interface
- Only restructure internals

Current verification score: ${(before.score * 100).toFixed(0)}%`,
            model,
            modelId,
        )

        // Step 3 — Execute the refactor
        yield* BuildAgent.executePlan(plan, model, modelId)

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
