import { Schema, Effect } from "effect"
import * as Tool from "./tool"
import { run as runPipeline, formatSummary } from "@monkeydcode/consistency/verification/pipeline"
import { InstanceState } from "@/effect/instance-state"

export const Parameters = Schema.Struct({
    files: Schema.Array(Schema.String).annotate({
        description: "File paths to verify (syntax → typecheck → lint → tests → smoke)",
    }),
    projectRoot: Schema.optional(Schema.String).annotate({
        description: "Project root for verification. Defaults to current instance directory.",
    }),
})

export const VerifyTool = Tool.define(
    "verify",
    Effect.succeed({
        description:
            "Run the monkeyDcode verification pipeline on the given files. " +
            "Stages: syntax, typecheck, lint, existing tests, optional smoke command.",
        parameters: Parameters,
        execute: (params: { files: string[]; projectRoot?: string }) =>
            Effect.gen(function* () {
                const ctx = yield* InstanceState.context
                const root = params.projectRoot ?? ctx.directory
                const result = yield* Effect.promise(() => runPipeline(params.files, root))
                return {
                    title: result.passed ? "Verification passed" : `Failed at ${result.stage}`,
                    output: formatSummary(result),
                    metadata: {
                        passed: result.passed,
                        stage: result.stage,
                        score: result.score,
                        errorCount: result.errors.length,
                    },
                }
            }),
    }),
)
