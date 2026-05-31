import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { readFile, writeFile } from "fs/promises"
import { join } from "path"
import { fileURLToPath } from "url"
import { $ } from "bun"
import * as Pipeline from "@monkeydcode/consistency/verification/pipeline"
import * as PlanAgent from "../plan-agent.ts"
import * as BuildAgent from "../build-agent.ts"

const PROMPTS = join(fileURLToPath(import.meta.url), "../../prompts")

export interface BugReport {
    error: string
    stack?: string
    suspectFiles?: string[]
}

export function fix(report: BugReport, model: ModelRef, modelId: string): Effect.Effect<boolean, unknown> {
    return Effect.gen(function* () {
        const suspectFiles = report.suspectFiles ?? (yield* localize(report))
        const projectRoot = process.cwd()

        // Step 1 — Write a failing test that reproduces the bug
        const reproPrompt = yield* Effect.tryPromise(() =>
            readFile(join(PROMPTS, "bugfix-reproduce.txt"), "utf-8")
        )
        const reproResponse = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{
                    role: "user",
                    content: reproPrompt
                        .replace("{REPORT}", report.error)
                        .replace("{STACK}", report.stack ?? "none")
                        .replace("{FILES}", suspectFiles.join(", ")),
                }],
            })
        )

        const testCode = extractCode(reproResponse.text)
        const testFile = join(projectRoot, "test", "bugfix-repro.test.ts")
        yield* Effect.tryPromise(() => writeFile(testFile, testCode))

        // Step 2 — Fix the bug using the plan → build pipeline
        const fixPlan = yield* PlanAgent.plan(
            `Fix this bug:\n${report.error}\n${report.stack ?? ""}\n\nFailing test is at: ${testFile}\nSuspect files: ${suspectFiles.join(", ")}`,
            modelId,
        )
        yield* BuildAgent.executePlan(fixPlan, modelId)

        // Step 3 — Verify the reproduction test now passes
        const result = yield* Effect.promise(() =>
            Pipeline.run([testFile, ...suspectFiles], projectRoot)
        )
        return result.passed
    })
}

function localize(report: BugReport): Effect.Effect<string[], unknown> {
    return Effect.tryPromise(async () => {
        const files: string[] = []
        if (report.stack) {
            const matches = report.stack.matchAll(/at .+?\((.+?):\d+:\d+\)/g)
            for (const m of matches) {
                const f = m[1]
                if (f && !f.includes("node_modules") && !files.includes(f)) files.push(f)
            }
        }
        if (files.length === 0) {
            const r = await $`git diff HEAD --name-only`.quiet().nothrow()
            return r.stdout.toString().trim().split("\n").filter(Boolean)
        }
        return files.slice(0, 5)
    })
}

function extractCode(text: string): string {
    const match = text.match(/```(?:\w+)?\n([\s\S]*?)```/)
    return match?.[1] ?? text
}
