// @ts-nocheck
import { Schema, Effect } from "effect"
import * as Tool from "./tool"
import { sample } from "@monkeydcode/consistency/sampler"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import { anthropic } from "@monkeydcode/llm/providers/anthropic"

function resolveModel(modelId: string) {
    if (modelId.startsWith("claude-")) return anthropic.model(modelId)
    if (modelId.includes(":")) return ollama.model(modelId)
    return ollama.model(modelId)
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
                const model = resolveModel(params.modelId)
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
