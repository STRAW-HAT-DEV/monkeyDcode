// @ts-nocheck
import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import { run as runPipeline, formatSummary } from "@monkeydcode/consistency/verification/pipeline"
import { InstanceState } from "@/effect/instance-state"

/** verify_pipeline — plan name for the verify tool */
export const VerifyPipelineTool = Tool.define(
    "verify_pipeline",
    Effect.succeed({
        description: "Run verification pipeline: syntax → typecheck → lint → tests → generated tests → smoke.",
        parameters: Schema.Struct({
            files: Schema.Array(Schema.String),
            projectRoot: Schema.optional(Schema.String),
        }),
        execute: (params: { files: string[]; projectRoot?: string }) =>
            Effect.gen(function* () {
                const ctx = yield* InstanceState.context
                const root = params.projectRoot ?? ctx.directory
                const result = yield* Effect.promise(() => runPipeline(params.files, root))
                return {
                    title: result.passed ? "Verification passed" : `Failed at ${result.stage}`,
                    output: formatSummary(result),
                    metadata: { passed: result.passed, stage: result.stage, score: result.score },
                }
            }),
    }),
)

/** plan — alias for plan_exit deliberation exit */
export { PlanExitTool as PlanTool } from "../plan"
