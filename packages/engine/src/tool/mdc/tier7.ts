// @ts-nocheck
import { Schema } from "effect"
import * as Memory from "@monkeydcode/context/memory"
import { mdcTool } from "./factory.ts"

export const RetainTool = mdcTool(
    "retain",
    "Queue durable facts to persist across sessions.",
    { fact: Schema.String },
    async (args) => {
        await Memory.retain(args.fact as string)
        return { title: "retain", output: "Fact retained." }
    },
)

export const RecallTool = mdcTool(
    "recall",
    "Search the session memory bank.",
    { query: Schema.String },
    async (args) => {
        const matches = await Memory.recall(args.query as string)
        return { title: "recall", output: matches.join("\n") || "No matches" }
    },
)

export const ReflectTool = mdcTool(
    "reflect",
    "Synthesise answers from retained memory.",
    { question: Schema.String },
    async (args) => {
        const answer = await Memory.reflect(args.question as string)
        return { title: "reflect", output: answer }
    },
)

export const CheckpointTool = mdcTool(
    "checkpoint",
    "Mark conversation state for possible rewind.",
    { label: Schema.String },
    async (args) => {
        const id = await Memory.checkpoint(args.label as string)
        return { title: "checkpoint", output: id, metadata: { checkpointId: id } }
    },
)

export const RewindTool = mdcTool(
    "rewind",
    "Prune exploratory context back to a checkpoint.",
    { checkpointId: Schema.String },
    async (args) => {
        const msg = await Memory.rewind(args.checkpointId as string)
        return { title: "rewind", output: msg }
    },
)

export const HandoffTool = mdcTool(
    "handoff",
    "Clean context transfer to a fresh agent instance (Amp-style).",
    { summary: Schema.String },
    async (args) => {
        const result = await Memory.handoff(args.summary as string)
        return { title: "handoff", output: result.summary, metadata: { freshContext: result.freshContext } }
    },
)
