import { Effect } from "effect"
import { LLM } from "@monkeydcode/llm"
import * as Capability from "@monkeydcode/consistency/model-capability/detector"
import type { ModelRef } from "@monkeydcode/llm"
import { readFile } from "fs/promises"
import { join } from "path"
import { fileURLToPath } from "url"
import { wrapReAct } from "./react.ts"

const PROMPTS_DIR = join(fileURLToPath(import.meta.url), "../prompts")

/** Max lines per step by decomposition level (plan/agents.md). */
const MAX_LOC: Record<number, number> = {
    1: Infinity,
    2: 100,
    3: 50,
    4: 30,
    5: 20,
    6: 20,
}

const MAX_DEPTH: Record<number, number> = {
    1: 2,
    2: 3,
    3: 4,
    4: 5,
    5: 6,
    6: 6,
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlanStep {
    description: string
    targetFiles: string[]
    changeType: "create" | "modify" | "delete"
    dependencies: number[]
    verificationCriteria: string
    /** Holistic/creative artifact (e.g. a landing page) — sampling and grading
     *  should favor diversity and taste over convergence-to-average. */
    creative?: boolean
}

export interface Plan {
    steps: PlanStep[]
    decompositionLevel: number
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function plan(task: string, model: ModelRef, modelId: string): Effect.Effect<Plan, unknown> {
    return Effect.gen(function* () {
        const level = yield* Capability.detect(model)
        const promptTemplate = yield* loadPrompt(level)
        const filledPrompt = wrapReAct(promptTemplate.replace("{TASK}", task))

        const response = yield* Effect.promise(() =>
            LLM.generateAsync({
                model,
                messages: [{ role: "user", content: filledPrompt }],
            })
        )

        const steps = enforceLevelConstraints(parseStepsFromResponse(response.text, task), level)
        return { steps, decompositionLevel: level }
    })
}

// ─── Prompt loader ────────────────────────────────────────────────────────────
// Tries exact level file first, then falls back toward level-6 (most explicit).

function loadPrompt(level: number): Effect.Effect<string, unknown> {
    return Effect.tryPromise(async () => {
        const candidates = [
            `plan-level-${level}.txt`,
            // Nearest level that exists
            ...Array.from({ length: 6 }, (_, i) => `plan-level-${6 - i}.txt`),
        ]
        for (const filename of candidates) {
            try {
                return await readFile(join(PROMPTS_DIR, filename), "utf-8")
            } catch {}
        }
        throw new Error("No plan prompt found")
    })
}

// ─── Response parser ──────────────────────────────────────────────────────────
// Tries multiple strategies because LLMs output JSON in many formats.
// Never returns an empty array — always produces at least one usable step.

export function parseStepsFromResponse(text: string, fallbackTask?: string): PlanStep[] {
    // Strategy 1: explicit ```json ... ``` fence
    const jsonFence = text.match(/```json\s*\n([\s\S]*?)```/)
    if (jsonFence?.[1]) {
        const parsed = tryParseJson(jsonFence[1].trim())
        if (parsed) return normalizeSteps(parsed)
    }

    // Strategy 2: any ``` ... ``` fence containing JSON
    const anyFence = text.match(/```(?:\w+)?\s*\n([\s\S]*?)```/)
    if (anyFence?.[1]?.trim().startsWith("[")) {
        const parsed = tryParseJson(anyFence[1].trim())
        if (parsed) return normalizeSteps(parsed)
    }

    // Strategy 3: bare JSON array anywhere in the text
    const arrayMatch = text.match(/\[\s*\{[\s\S]*?\}\s*\]/)
    if (arrayMatch?.[0]) {
        const parsed = tryParseJson(arrayMatch[0])
        if (parsed) return normalizeSteps(parsed)
    }

    // Strategy 4: entire text is JSON
    const wholeParsed = tryParseJson(text.trim())
    if (wholeParsed) return normalizeSteps(wholeParsed)

    // Strategy 5: numbered list  "1. Do X to file.ts"
    const listSteps = parseNumberedList(text)
    if (listSteps.length > 0) return listSteps

    // Fallback: single step from the whole response (never silently lose the task)
    return [{
        description: (fallbackTask ?? text.trim()).slice(0, 300),
        targetFiles: extractFilePaths(text),
        changeType: "modify",
        dependencies: [],
        verificationCriteria: "Code compiles and existing tests pass",
    }]
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function tryParseJson(text: string): unknown[] | null {
    try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return [parsed]
    } catch {}
    return null
}

function normalizeSteps(raw: unknown[]): PlanStep[] {
    return raw
        .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
        .map((item, i): PlanStep => ({
            description:         String(item["description"] ?? item["task"] ?? item["action"] ?? `Step ${i + 1}`),
            targetFiles:         normalizeFileList(item["targetFiles"] ?? item["files"] ?? item["file"] ?? []),
            changeType:          normalizeChangeType(item["changeType"] ?? item["type"] ?? "modify"),
            dependencies:        Array.isArray(item["dependencies"]) ? (item["dependencies"] as number[]) : [],
            verificationCriteria: String(item["verificationCriteria"] ?? item["verification"] ?? "Code compiles and tests pass"),
        }))
        .filter(s => s.description.length > 0)
}

function normalizeFileList(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String).filter(Boolean)
    if (typeof value === "string" && value.length > 0) return [value]
    return []
}

function normalizeChangeType(value: unknown): "create" | "modify" | "delete" {
    const v = String(value).toLowerCase()
    if (v === "create" || v === "new" || v === "add") return "create"
    if (v === "delete" || v === "remove") return "delete"
    return "modify"
}

function parseNumberedList(text: string): PlanStep[] {
    const lines = text.split("\n")
    const steps: PlanStep[] = []
    for (const line of lines) {
        const m = line.match(/^\s*\d+[.)]\s+(.+)/)
        if (m?.[1]) {
            steps.push({
                description: m[1].trim(),
                targetFiles: extractFilePaths(m[1]),
                changeType: "modify",
                dependencies: steps.length > 0 ? [steps.length - 1] : [],
                verificationCriteria: "Code compiles and tests pass",
            })
        }
    }
    return steps
}

function extractFilePaths(text: string): string[] {
    const paths: string[] = []
    const matches = text.matchAll(/(?:^|\s)([^\s`"']+\.(?:ts|tsx|js|jsx|py|go|rs|json|yaml|toml))(?:\s|$|[,)'":])/g)
    for (const m of matches) {
        if (m[1]) paths.push(m[1])
    }
    return [...new Set(paths)]
}

/** Split steps that violate max LOC / depth for the model level. */
function enforceLevelConstraints(steps: PlanStep[], level: number): PlanStep[] {
    const maxLoc = MAX_LOC[level] ?? 20
    const maxSteps = MAX_DEPTH[level] ?? 6
    const out: PlanStep[] = []

    for (const step of steps) {
        const estLines = step.description.split("\n").length + step.targetFiles.length * 5
        if (estLines > maxLoc && step.targetFiles.length > 1) {
            for (const f of step.targetFiles) {
                out.push({ ...step, targetFiles: [f], description: `${step.description} (file: ${f})` })
            }
        } else {
            out.push(step)
        }
    }

    return out.slice(0, maxSteps)
}
