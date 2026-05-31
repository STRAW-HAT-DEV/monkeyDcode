import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { readFile } from "fs/promises"
import { join } from "path"
import { fileURLToPath } from "url"
import { $ } from "bun"

const PROMPTS = join(fileURLToPath(import.meta.url), "../prompts")

export interface ReviewIssue {
    severity: "critical" | "high" | "medium" | "low"
    type: "bug" | "security" | "performance" | "style" | "missing-edge-case"
    file: string
    line: number
    message: string
    suggestion?: string
}

async function getDiff(): Promise<string> {
    const r = await $`git diff HEAD`.quiet().nothrow()
    const staged = await $`git diff --cached HEAD`.quiet().nothrow()
    return (r.stdout.toString() + staged.stdout.toString()).trim() || "No diff available"
}

function parseIssues(text: string): ReviewIssue[] {
    try {
        const match = text.match(/\[[\s\S]*\]/)
        if (match) return JSON.parse(match[0]) as ReviewIssue[]
    } catch {}
    return []
}

export function review(model: ModelRef): Effect.Effect<ReviewIssue[], unknown> {
    return Effect.gen(function* () {
        const diff = yield* Effect.tryPromise(() => getDiff())

        const [actorTpl, criticTpl, consensusTpl] = yield* Effect.all([
            Effect.tryPromise(() => readFile(join(PROMPTS, "review-actor.txt"), "utf-8")),
            Effect.tryPromise(() => readFile(join(PROMPTS, "review-critic.txt"), "utf-8")),
            Effect.tryPromise(() => readFile(join(PROMPTS, "review-consensus.txt"), "utf-8")),
        ])

        // Round 1 — Actor
        const actorResponse = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{
                    role: "user",
                    content: actorTpl!.replace("{DIFF}", diff),
                }],
            })
        )
        const actorIssues = parseIssues(actorResponse.text)

        // Round 2 — Critic
        const criticResponse = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{
                    role: "user",
                    content: criticTpl!
                        .replace("{DIFF}", diff)
                        .replace("{ISSUES}", JSON.stringify(actorIssues, null, 2)),
                }],
            })
        )

        // Round 3 — Consensus
        const consensusResponse = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{
                    role: "user",
                    content: consensusTpl!
                        .replace("{DIFF}", diff)
                        .replace("{ACTOR}", JSON.stringify(actorIssues, null, 2))
                        .replace("{CRITIC}", criticResponse.text),
                }],
            })
        )

        return parseIssues(consensusResponse.text)
    })
}
