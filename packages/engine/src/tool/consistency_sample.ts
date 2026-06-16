// @ts-nocheck
import { Schema, Effect } from "effect"
import * as Tool from "./tool"
import { sample } from "@monkeydcode/consistency/sampler"
import { loadConfig } from "@monkeydcode/core/mdc-config"
import { bootstrapLLM, resolveModel } from "@monkeydcode/llm"

async function resolveModelForId(modelId: string) {
    const config = await loadConfig()
    await bootstrapLLM(config)
    return resolveModel(config.provider, modelId)
}

export const Parameters = Schema.Struct({
    prompt: Schema.String,
    files: Schema.Array(Schema.String),
    modelId: Schema.String,
})

export const ConsistencySampleTool = Tool.define(
    "consistency_sample",
    Effect.succeed({
        description: "Multi-temperature candidate generation with verification and RRP grading.",
        parameters: Parameters,
        execute: (params: { prompt: string; files: string[]; modelId: string }) =>
            Effect.gen(function* () {
                const model = yield* Effect.promise(() => resolveModelForId(params.modelId))
                const result = yield* sample({
                    prompt: params.prompt,
                    files: params.files,
                    model,
                    modelId: params.modelId,
                })
                return {
                    title: "Consistency sampling complete",
                    output: result.selected.change.slice(0, 4000),
                    metadata: {
                        confidence: result.confidence,
                        rrpScore: result.selected.rrpScore,
                        temperature: result.selected.temperature,
                    },
                }
            }),
    }),
)
