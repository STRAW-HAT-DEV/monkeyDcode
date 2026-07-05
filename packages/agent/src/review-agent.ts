import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import * as Capability from "@monkeydcode/consistency/model-capability/detector"
import { readFile } from "fs/promises"
import { join } from "path"
import { fileURLToPath } from "url"
import { $ } from "bun"
import * as Status from "./status.ts"
import { parseJsonArray, parseJsonObject } from "./utils.ts"

const PROMPTS = join(fileURLToPath(import.meta.url), "../prompts")

export interface ReviewIssue {
    severity: "critical" | "high" | "medium" | "low"
    type: "bug" | "security" | "performance" | "style" | "missing-edge-case"
    file: string
    line: number
    message: string
    suggestion?: string
}

/** The critic's structured verdict — see review-critic.txt's required shape. */
interface CriticVerdict {
    validated?: ReviewIssue[]
    false_positives?: ReviewIssue[]
    missed?: ReviewIssue[]
}

async function getDiff(): Promise<string> {
    const r = await $`git diff HEAD`.quiet().nothrow()
    const staged = await $`git diff --cached HEAD`.quiet().nothrow()
    return (r.stdout.toString() + staged.stdout.toString()).trim() || "No diff available"
}

function parseIssues(text: string): ReviewIssue[] {
    return parseJsonArray<ReviewIssue>(text)
}

/**
 * The critic emits an OBJECT ({validated, false_positives, missed}), not an
 * array. Parsing it as an array would silently keep only whichever field's
 * bracket the parser happened to hit first and drop the critic's real
 * contributions — its newly-found `missed` issues and its false-positive
 * rejections — leaving the whole adversarial round inert. Return the critic's
 * affirmative set of real issues (validated ∪ missed) for the consensus round
 * to merge against the actor's list. */
function parseCriticIssues(text: string): ReviewIssue[] {
    const verdict = parseJsonObject<CriticVerdict>(text)
    if (!verdict) {
        // Critic didn't produce the structured object — degrade gracefully to
        // array parsing rather than losing the round entirely.
        return parseIssues(text)
    }
    return dedupeIssues([...(verdict.validated ?? []), ...(verdict.missed ?? [])])
}

/** De-duplicate issues by file+line+message (validated and missed can overlap
 *  when the critic re-affirms an actor finding it also considers under-counted). */
function dedupeIssues(issues: ReviewIssue[]): ReviewIssue[] {
    const seen = new Set<string>()
    const out: ReviewIssue[] = []
    for (const issue of issues) {
        const key = `${issue.file}:${issue.line}:${issue.message}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push(issue)
    }
    return out
}

// Adaptive effort ceiling: a strong model reviewing a small diff doesn't need
// two more rounds to second-guess itself — that's cost and latency with no
// accuracy gain, and consensus can water down a strong model's own correct
// judgment toward the middle. Weak models and larger diffs keep the full
// adversarial Actor→Critic→Consensus pipeline, where it earns its cost.
const STRONG_MODEL_LEVEL_THRESHOLD = 2
const SMALL_DIFF_LINE_THRESHOLD = 30

/** Actor-Critique review: up to 3 rounds per plan/agents.md, single-pass for
 *  strong models on small diffs (see thresholds above). */
export function review(model: ModelRef): Effect.Effect<ReviewIssue[], unknown> {
    return Effect.gen(function* () {
        const diff = yield* Effect.tryPromise(() => getDiff())
        if (diff === "No diff available") return []

        const level = yield* Capability.detect(model)
        const singlePass = level <= STRONG_MODEL_LEVEL_THRESHOLD && diff.split("\n").length <= SMALL_DIFF_LINE_THRESHOLD

        const actorTpl = yield* Effect.tryPromise(() => readFile(join(PROMPTS, "review-actor.txt"), "utf-8"))
        Status.emit({
            agent: "robin",
            action: singlePass ? "Review — Actor scanning diff..." : "Review Round 1/3 — Actor scanning diff...",
            diff,
        })

        // Round 1 — Actor
        const actorResponse = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{ role: "user", content: actorTpl.replace("{DIFF}", diff) }],
            })
        )
        const actorIssues = parseIssues(actorResponse.text)

        if (singlePass) {
            Status.emit({
                agent: "robin",
                action: actorIssues.length > 0
                    ? `Review complete — ${actorIssues.length} issue(s) (single-pass: strong model, small diff)`
                    : "Review complete — no issues found (single-pass)",
                diff,
            })
            return actorIssues
        }

        Status.emit({
            agent: "robin",
            action: `Review Round 2/3 — Critic challenging ${actorIssues.length} actor finding(s)...`,
            diff,
        })

        const [criticTpl, consensusTpl] = yield* Effect.all([
            Effect.tryPromise(() => readFile(join(PROMPTS, "review-critic.txt"), "utf-8")),
            Effect.tryPromise(() => readFile(join(PROMPTS, "review-consensus.txt"), "utf-8")),
        ])

        // Round 2 — Critic
        const criticResponse = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{
                    role: "user",
                    content: criticTpl
                        .replace("{DIFF}", diff)
                        .replace("{ISSUES}", JSON.stringify(actorIssues, null, 2)),
                }],
            })
        )
        const criticIssues = parseCriticIssues(criticResponse.text)
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
                    content: consensusTpl
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
