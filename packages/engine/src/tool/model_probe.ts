// @ts-nocheck
import { Schema, Effect } from "effect"
import * as Tool from "./tool"
import { detect } from "@monkeydcode/consistency/model-capability/detector"
import { resolveModel } from "@monkeydcode/llm"
import { loadConfig } from "@monkeydcode/core/mdc-config"

export const Parameters = Schema.Struct({
    modelId: Schema.String,
})

export const ModelProbeTool = Tool.define(
    "model_probe",
    Effect.succeed({
        description: "Detect model capability level (1–6) and adapt decomposition/sampling.",
        parameters: Parameters,
        execute: (params: { modelId: string }) =>
            Effect.gen(function* () {
                const cfg = yield* Effect.tryPromise(() => loadConfig())
                const model = resolveModel(cfg.provider, params.modelId)
                const level = yield* detect(model)
                return {
                    title: `Model capability: level ${level}`,
                    output: `Model "${params.modelId}" is capability level ${level} (1=frontier, 6=weak local)`,
                    metadata: { level },
                }
            }),
    }),
)
