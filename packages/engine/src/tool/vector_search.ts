// @ts-nocheck
import { Schema, Effect } from "effect"
import * as Tool from "./tool"
import { search } from "@monkeydcode/context/vector-store"
import { InstanceState } from "@/effect/instance-state"

export const Parameters = Schema.Struct({
    query: Schema.String,
    limit: Schema.optional(Schema.Number),
})

export const VectorSearchTool = Tool.define(
    "vector_search",
    Effect.succeed({
        description: "Semantic code search across the project vector store.",
        parameters: Parameters,
        execute: (params: { query: string; limit?: number }) =>
            Effect.gen(function* () {
                yield* InstanceState.context
                const results = yield* search(params.query, params.limit ?? 5)
                return {
                    title: "Vector search results",
                    output: results.map(r => `[${r.score.toFixed(2)}] ${r.text.slice(0, 500)}`).join("\n---\n") || "No matches",
                    metadata: { count: results.length },
                }
            }),
    }),
)
