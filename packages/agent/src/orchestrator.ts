import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { readFile } from "fs/promises"
import { join } from "path"
import { fileURLToPath } from "url"
import { $ } from "bun"
import * as Pipeline from "@monkeydcode/consistency/verification/pipeline"
import { initSessionContext } from "@monkeydcode/context/session-init"
import * as PlanAgent from "./plan-agent.ts"
import * as BuildAgent from "./build-agent.ts"
import * as ReviewAgent from "./review-agent.ts"
import * as BugFix from "./sub-agents/bugfix.ts"
import * as Feature from "./sub-agents/feature.ts"
import * as Refactor from "./sub-agents/refactor.ts"
import * as Debug from "./sub-agents/debug.ts"
import * as Status from "./status.ts"
import * as WorkingMemory from "./working-memory.ts"

const PROMPTS = join(fileURLToPath(import.meta.url), "../prompts")

type Category = "bug_fix" | "feature" | "refactor" | "debug" | "chat" | "general"

let contextInitialized = false

export function handle(message: string, model: ModelRef, modelId: string): Effect.Effect<string, unknown> {
    return Effect.gen(function* () {
        yield* WorkingMemory.setGoal(message)
        Status.emit({ agent: "luffy", action: "Classifying request..." })

        const category = yield* classify(message, model)

        // Fast path: conversational input never touches the build/verify/review pipeline.
        if (category === "chat") {
            Status.emit({ agent: "luffy", action: "Replying..." })
            const reply = yield* chatReply(message, model)
            Status.emit({ agent: "idle", action: "Done" })
            return reply
        }

        if (!contextInitialized) {
            yield* initSessionContext(process.cwd())
            contextInitialized = true
        }

        switch (category) {
            case "bug_fix":
                Status.emit({ agent: "zoro", action: "Hunting the bug..." })
                yield* BugFix.fix({ error: message }, model, modelId)
                break

            case "feature":
                Status.emit({ agent: "nami", action: "Charting feature plan..." })
                yield* Feature.build(message, model, modelId)
                break

            case "refactor": {
                const target = extractTarget(message)
                Status.emit({ agent: "sanji", action: `Refactoring ${target}...` })
                yield* Refactor.refactor(target, message, model, modelId)
                break
            }

            case "debug":
                Status.emit({ agent: "usopp", action: "Testing hypotheses..." })
                yield* Debug.debug(message, model, modelId)
                break

            default: {
                Status.emit({ agent: "luffy", action: "Creating plan..." })
                const plan = yield* PlanAgent.plan(message, model, modelId)
                Status.emit({
                    agent: "franky",
                    action: `Executing ${plan.steps.length} steps (level ${plan.decompositionLevel})...`,
                    plan,
                    progress: { current: 0, total: plan.steps.length },
                })
                yield* BuildAgent.executePlan(plan, model, modelId)
            }
        }

        // Full-changeset verification before review (plan/verification.md)
        const diff = yield* Effect.tryPromise(() => getDiff())

        // Nothing was changed on disk → skip the heavy verify + review pipeline.
        if (diff === "No diff available") {
            Status.emit({ agent: "idle", action: "Done" })
            return `Done (${category}). No file changes were produced.`
        }

        const srcFiles = yield* Effect.tryPromise(() => collectSourceFiles(process.cwd()))
        Status.emit({ agent: "robin", action: "Verifying full changeset...", diff })

        if (srcFiles.length > 0) {
            const fullVerify = yield* Effect.tryPromise(() => Pipeline.run(srcFiles, process.cwd()))
            if (!fullVerify.passed) {
                Status.emit({
                    agent: "franky",
                    action: `Fixing verification failures before review (${fullVerify.stage})...`,
                })
                yield* BuildAgent.executePlan({
                    steps: [{
                        description: `Fix verification failures:\n${Pipeline.formatErrors(fullVerify)}`,
                        targetFiles: srcFiles.slice(0, 5),
                        changeType: "modify",
                        dependencies: [],
                        verificationCriteria: "Full verification pipeline passes",
                    }],
                    decompositionLevel: 1,
                }, model, modelId)
            }
        }

        Status.emit({ agent: "robin", action: "Running Actor-Critic review...", diff })
        const issues = yield* ReviewAgent.review(model)

        const criticalOrHigh = issues.filter(
            i => i.severity === "critical" || i.severity === "high",
        )

        if (criticalOrHigh.length > 0) {
            Status.emit({
                agent: "franky",
                action: `Fixing ${criticalOrHigh.length} critical/high issue(s)...`,
            })
            const fixSteps = criticalOrHigh.map(i => ({
                description: `Fix ${i.severity} issue: ${i.message}${i.suggestion ? `\n\nSuggested fix: ${i.suggestion}` : ""}`,
                targetFiles: [i.file].filter(Boolean),
                changeType: "modify" as const,
                dependencies: [],
                verificationCriteria: `Issue resolved: ${i.message}`,
            }))

            yield* BuildAgent.executePlan(
                { steps: fixSteps, decompositionLevel: 1 },
                model,
                modelId,
            )
        }

        Status.emit({ agent: "idle", action: "Done" })
        const reviewed = criticalOrHigh.length > 0
            ? ` Fixed ${criticalOrHigh.length} critical/high review issue(s).`
            : " Review passed clean."
        return `Done (${category}).${reviewed}`
    })
}

function chatReply(message: string, model: ModelRef): Effect.Effect<string, unknown> {
    return Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [
                    {
                        role: "system",
                        content:
                            "You are monkeyDcode, a friendly coding agent. Answer concisely. " +
                            "If the user wants you to change code, tell them to describe the task " +
                            "(e.g. \"fix the bug in auth.ts\" or \"add pagination to the users API\").",
                    },
                    { role: "user", content: message },
                ],
            }),
        )
        return response.text.trim()
    })
}

function classify(message: string, model: ModelRef): Effect.Effect<Category, unknown> {
    return Effect.gen(function* () {
        const template = yield* Effect.tryPromise(() =>
            readFile(join(PROMPTS, "classify.txt"), "utf-8"),
        )
        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{
                    role: "user",
                    content: template.replace("{MESSAGE}", message),
                }],
            }),
        )
        const raw = response.text.trim().toLowerCase()
        const valid: Category[] = ["bug_fix", "feature", "refactor", "debug", "chat", "general"]
        return valid.find(c => raw.includes(c)) ?? "chat"
    })
}

function extractTarget(message: string): string {
    const match = message.match(/(?:refactor|clean up|restructure)\s+([^\s,]+)/i)
    return match?.[1] ?? process.cwd()
}

async function getDiff(): Promise<string> {
    const r = await $`git diff HEAD`.quiet().nothrow()
    const staged = await $`git diff --cached HEAD`.quiet().nothrow()
    return (r.stdout.toString() + staged.stdout.toString()).trim() || "No diff available"
}

async function collectSourceFiles(root: string): Promise<string[]> {
    const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,py,rs,go}")
    const files: string[] = []
    for await (const f of glob.scan({ cwd: root, absolute: true })) {
        if (!f.includes("node_modules") && !f.includes(".git") && !f.includes("dist")) {
            files.push(f)
        }
    }
    return files.slice(0, 50)
}
