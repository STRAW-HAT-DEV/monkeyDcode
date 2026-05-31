import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { readFile } from "fs/promises"
import { join } from "path"
import { fileURLToPath } from "url"
import * as PlanAgent from "./plan-agent.ts"
import * as BuildAgent from "./build-agent.ts"
import * as ReviewAgent from "./review-agent.ts"
import * as BugFix from "./sub-agents/bugfix.ts"
import * as Feature from "./sub-agents/feature.ts"
import * as Refactor from "./sub-agents/refactor.ts"
import * as Debug from "./sub-agents/debug.ts"

const PROMPTS = join(fileURLToPath(import.meta.url), "../prompts")

type Category = "bug_fix" | "feature" | "refactor" | "debug" | "general"

export function handle(message: string, model: ModelRef, modelId: string): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        const category = yield* classify(message, model)

        // Route to the right specialist
        switch (category) {
            case "bug_fix":
                yield* BugFix.fix({ error: message }, model, modelId)
                break

            case "feature":
                yield* Feature.build(message, model, modelId)
                break

            case "refactor": {
                const target = extractTarget(message)
                yield* Refactor.refactor(target, message, model, modelId)
                break
            }

            case "debug":
                yield* Debug.debug(message, model, modelId)
                break

            default: {
                const plan = yield* PlanAgent.plan(message, modelId)
                yield* BuildAgent.executePlan(plan, modelId)
            }
        }

        // After every task — run the Actor-Critic-Consensus review
        const issues = yield* ReviewAgent.review(model)

        const criticalOrHigh = issues.filter(
            i => i.severity === "critical" || i.severity === "high"
        )

        // Auto-fix critical and high issues
        if (criticalOrHigh.length > 0) {
            const fixSteps = criticalOrHigh.map(i => ({
                description: `Fix ${i.severity} issue: ${i.message}${i.suggestion ? `\n\nSuggested fix: ${i.suggestion}` : ""}`,
                targetFiles: [i.file].filter(Boolean),
                changeType: "modify" as const,
                dependencies: [],
                verificationCriteria: `Issue resolved: ${i.message}`,
            }))

            yield* BuildAgent.executePlan(
                { steps: fixSteps, decompositionLevel: 1 },
                modelId,
            )
        }
    })
}

function classify(message: string, model: ModelRef): Effect.Effect<Category, unknown> {
    return Effect.gen(function* () {
        const template = yield* Effect.tryPromise(() =>
            readFile(join(PROMPTS, "classify.txt"), "utf-8")
        )
        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{
                    role: "user",
                    content: template.replace("{MESSAGE}", message),
                }],
            })
        )
        const raw = response.text.trim().toLowerCase()
        const valid: Category[] = ["bug_fix", "feature", "refactor", "debug", "general"]
        return valid.find(c => raw.includes(c)) ?? "general"
    })
}

function extractTarget(message: string): string {
    const match = message.match(/(?:refactor|clean up|restructure)\s+([^\s,]+)/i)
    return match?.[1] ?? process.cwd()
}
