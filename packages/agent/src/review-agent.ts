import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { readFile } from "fs/promises"
import { join } from "path"
import { fileURLToPath } from "url"
import { $ } from "bun"
import * as Status from "./status.ts"

const PROMPTS = join(fileURLToPath(import.meta.url), "../prompts")

export interface ReviewIssue {
    severity: "critical" | "high" | "medium" | "low"
    type: "bug" | "security" | "performance" | "style" | "missing-edge-case"
    file: string
    line: number
    message: string
    suggestion?: string
}

export interface ReviewResult {
    issues: ReviewIssue[]
    actorIssueCount: number
    criticAdditions: number
    rounds: 3
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

/** Actor-Critique review: 3 rounds per plan/agents.md */
export function review(model: ModelRef): Effect.Effect<ReviewIssue[], unknown> {
    return Effect.gen(function* () {
        const diff = yield* Effect.tryPromise(() => getDiff())
        Status.emit({ agent: "robin", action: "Review Round 1/3 — Actor scanning diff...", diff })

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
        Status.emit({
            agent: "robin",
            action: `Review Round 2/3 — Critic challenging ${actorIssues.length} actor finding(s)...`,
            diff,
        })

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
        const criticIssues = parseIssues(criticResponse.text)
        Status.emit({
            agent: "robin",
            action: `Review Round 3/3 — Consensus on ${actorIssues.length + criticIssues.length} issue(s)...`,
            diff,
        })

        // Round 3 — Consensus
        const consensusResponse = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{
                    role: "user",
                    content: consensusTpl!
                        .replace("{DIFF}", diff)
                        .replace("{ACTOR}", JSON.stringify(actorIssues, null, 2))
                        .replace("{CRITIC}", JSON.stringify(criticIssues, null, 2)),
                }],
            })
        )

        const finalIssues = parseIssues(consensusResponse.text)
        Status.emit({
            agent: "robin",
            action: finalIssues.length > 0
                ? `Review complete — ${finalIssues.length} actionable issue(s)`
                : "Review complete — no issues found",
            diff,
        })

        return finalIssues
    })
}
