import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { readFile, writeFile } from "fs/promises"
import { join } from "path"
import { fileURLToPath } from "url"
import { $ } from "bun"
import * as PlanAgent from "../plan-agent.ts"
import * as BuildAgent from "../build-agent.ts"
import { parseJsonArray } from "../utils.ts"

const PROMPTS = join(fileURLToPath(import.meta.url), "../../prompts")

interface Hypothesis {
    hypothesis: string
    likelihood: "high" | "medium" | "low"
    location: { file: string; function: string; line: number }
    confirmationTest: string
}

export function debug(traceback: string, model: ModelRef, modelId: string): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        // Step 1 — Gather context from the traceback
        const suspectFiles = extractFilesFromTraceback(traceback)
        const context = yield* gatherContext(suspectFiles)

        // Step 2 — Generate hypotheses (HyDE: Hypothetical Document Embeddings approach)
        const hypothesisPrompt = yield* Effect.tryPromise(() =>
            readFile(join(PROMPTS, "debug-hypothesize.txt"), "utf-8")
        )
        const hypothesisResponse = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{
                    role: "user",
                    content: hypothesisPrompt
                        .replace("{TRACEBACK}", traceback)
                        .replace("{CONTEXT}", context),
                }],
            })
        )

        const hypotheses = parseHypotheses(hypothesisResponse.text)

        // Step 3 — Test each hypothesis from most to least likely
        for (const h of hypotheses) {
            const confirmed = yield* testHypothesis(h, model)
            if (confirmed) {
                // Step 4 — Fix the confirmed root cause
                const fixPlan = yield* PlanAgent.plan(
                    `Fix this confirmed bug:\n${h.hypothesis}\n\nLocation: ${h.location.file}:${h.location.line} in ${h.location.function}\n\nTraceback:\n${traceback}`,
                    model,
                    modelId,
                )
                yield* BuildAgent.executePlan(fixPlan, model, modelId)
                return
            }
        }

        // No hypothesis confirmed — fall back to general fix
        const fallbackPlan = yield* PlanAgent.plan(
            `Debug and fix this error. No hypothesis was confirmed — investigate broadly:\n${traceback}`,
            model,
            modelId,
        )
        yield* BuildAgent.executePlan(fallbackPlan, model, modelId)
    })
}

function extractFilesFromTraceback(traceback: string): string[] {
    const files: string[] = []
    const matches = traceback.matchAll(/(?:at .+?\(|File ")(.+?)(?::\d+)/g)
    for (const m of matches) {
        const f = m[1]
        if (f && !f.includes("node_modules") && !files.includes(f)) files.push(f)
    }
    return files.slice(0, 5)
}

function gatherContext(files: string[]): Effect.Effect<string, unknown> {
    return Effect.tryPromise(async () => {
        const contents: string[] = []
        for (const f of files) {
            try {
                const content = await Bun.file(f).text()
                contents.push(`// ${f}\n${content.slice(0, 2000)}`)
            } catch {}
        }
        return contents.join("\n\n---\n\n")
    })
}

function parseHypotheses(text: string): Hypothesis[] {
    return parseJsonArray<Hypothesis>(text)
}

function testHypothesis(h: Hypothesis, model: ModelRef): Effect.Effect<boolean, unknown> {
    return Effect.promise(() =>
        LLM.generateAsync({
            model,
            messages: [{
                role: "user",
                content: `Does the code at ${h.location.file}:${h.location.line} confirm this hypothesis?\n\nHypothesis: ${h.hypothesis}\n\nConfirmation test: ${h.confirmationTest}\n\nAnswer YES or NO and explain in one sentence.`,
            }],
        }).then(r => r.text.trim().toUpperCase().startsWith("YES"))
    )
}
