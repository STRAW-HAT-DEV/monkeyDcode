import { Schema, Effect } from "effect"
import * as Tool from "./tool"
import { call } from "@monkeydcode/python-bridge/bridge"
import { InstanceState } from "@/effect/instance-state"

export const Parameters = Schema.Struct({
    node: Schema.String,
    depth: Schema.optional(Schema.Number),
})

export const KnowledgeGraphTool = Tool.define(
    "knowledge_graph",
    Effect.succeed({
        description: "Query the project knowledge graph for related files and dependencies.",
        parameters: Parameters,
        execute: (params: { node: string; depth?: number }) =>
            Effect.gen(function* () {
                const ctx = yield* InstanceState.context
                const neighbors = yield* Effect.promise(() =>
                    call<string[]>("knowledgeGraph.neighbors", {
                        node: params.node,
                        depth: params.depth ?? 1,
                        project_root: ctx.directory,
                    }).catch(() => [] as string[]),
                )
                return {
                    title: "Knowledge graph neighbors",
                    output: neighbors.length ? neighbors.join("\n") : "No neighbors found",
                    metadata: { count: neighbors.length },
                }
            }),
    }),
)
