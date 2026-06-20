// @ts-nocheck
/** Lightweight factory for monkeyDcode/omp tools — keeps Effect typing simple. */
import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import type { Def } from "../tool"
import { InstanceState } from "@/effect/instance-state"

type RunFn = (
    args: Record<string, unknown>,
    ctx: { directory: string },
) => Promise<{ title: string; output: string; metadata?: Record<string, unknown> }>

export function mdcTool(
    id: string,
    description: string,
    fields: Record<string, Schema.Schema<any, any>>,
    run: RunFn,
) {
    const parameters = Schema.Struct(fields)
    return Tool.define(
        id,
        Effect.succeed({
            description,
            parameters,
            execute: (args: Record<string, unknown>) =>
                Effect.gen(function* () {
                    const ctx = yield* InstanceState.context
                    const result = yield* Effect.promise(() => run(args, ctx))
                    return {
                        title: result.title,
                        output: result.output,
                        metadata: result.metadata ?? {},
                    }
                }),
        }),
    )
}

/** Clone an initialized tool def under a plan-compliant alias ID. */
export function aliasTool(def: Def, id: string): Def {
    return { ...def, id }
}
