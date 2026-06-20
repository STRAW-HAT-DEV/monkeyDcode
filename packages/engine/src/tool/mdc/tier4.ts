// @ts-nocheck
import { Schema, Effect } from "effect"
import * as Tool from "../tool"
import { InstanceState } from "@/effect/instance-state"
import { Git } from "@/git"
import { $ } from "bun"
import { mdcTool } from "./factory.ts"

export const GitTool = Tool.define(
    "git",
    Effect.gen(function* () {
        const git = yield* Git.Service
        return {
            description: "Git operations: status, diff, log, commit, branch, blame, stash.",
            parameters: Schema.Struct({
                args: Schema.Array(Schema.String).pipe(Schema.annotate({ description: "Git arguments, e.g. [\"status\"] or [\"log\", \"-3\"]" })),
            }),
            execute: (params: { args: string[] }) =>
                Effect.gen(function* () {
                    const ctx = yield* InstanceState.context
                    const result = yield* git.run(params.args, { cwd: ctx.directory })
                    return {
                        title: `git ${params.args.join(" ")}`,
                        output: result.text() || result.stderr.toString(),
                        metadata: { exitCode: result.exitCode },
                    }
                }),
        }
    }),
)

export const GithubTool = mdcTool(
    "github",
    "GitHub CLI: PRs, issues, reviews, comments, Actions via gh.",
    {
        args: Schema.Array(Schema.String).pipe(Schema.annotate({ description: "gh subcommand args, e.g. [\"pr\", \"list\"]" })),
    },
    async (args, ctx) => {
        const ghArgs = args.args as string[]
        const r = await $`gh ${ghArgs}`.cwd(ctx.directory).quiet().nothrow()
        return {
            title: `gh ${ghArgs.join(" ")}`,
            output: r.stdout.toString() + r.stderr.toString(),
            metadata: { exitCode: r.exitCode },
        }
    },
)
