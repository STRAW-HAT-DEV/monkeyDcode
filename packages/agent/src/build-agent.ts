import { Effect } from "effect"
import { writeFile } from "fs/promises"
import { basename, extname } from "path"
import * as Sampler from "@monkeydcode/consistency/sampler"
import * as Retriever from "@monkeydcode/context/retriever"
import * as Capability from "@monkeydcode/consistency/model-capability/detector"
import type { Plan, PlanStep } from "./plan-agent.ts"
import { resolveModel } from "./utils.ts"
import * as WorkingMemory from "./working-memory.ts"

export type { Plan, PlanStep }

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtractedBlock {
    filename?: string
    language?: string
    code: string
    isDiff: boolean
}

// ─── Plan execution ───────────────────────────────────────────────────────────

export function executePlan(plan: Plan, modelId: string): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i]!
            yield* executeStep(step, modelId, i)
        }
    })
}

function executeStep(step: PlanStep, modelId: string, index: number): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        const capabilityLevel = yield* Capability.detect(modelId)

        const context = yield* Retriever.retrieve(
            { files: step.targetFiles, description: step.description },
            { capabilityLevel },
        )

        const prompt = buildExecutionPrompt(step, context)
        const model = resolveModel(modelId)

        const result = yield* Sampler.sample({
            prompt,
            files: step.targetFiles,
            model,
            modelId,
        })

        yield* applyChange(result.selected.change, step.targetFiles)

        yield* WorkingMemory.update({
            completedSteps: [{ index, confidence: result.confidence, timestamp: new Date().toISOString() }],
        })
    })
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildExecutionPrompt(step: PlanStep, context: Retriever.AssembledContext): string {
    const fileList = step.targetFiles.join("\n")
    return `${Retriever.formatForPrompt(context)}

## Task
${step.description}

## Target Files
${fileList}

## Verification Criteria
${step.verificationCriteria}

## Output Format — CRITICAL
For EACH file you modify, output a separate code block with the filename as the label:

\`\`\`typescript:path/to/file.ts
// complete file contents here
\`\`\`

Rules:
- Output the COMPLETE file contents, not just the changed lines
- Use the exact file path from Target Files as the label
- One code block per file
- Never output partial files or diffs`
}

// ─── applyChange ─────────────────────────────────────────────────────────────

export function applyChange(change: string, targetFiles: string[]): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        const blocks = extractCodeBlocks(change)

        if (blocks.length === 0) {
            // No code blocks at all — write raw response to single-file target
            if (targetFiles.length === 1 && targetFiles[0]) {
                yield* Effect.tryPromise(() => writeFile(targetFiles[0]!, change.trim()))
            }
            return
        }

        if (targetFiles.length === 1 && targetFiles[0]) {
            // Single target: use the best matching block, fall back to first
            const best = matchBlockToFile(blocks, targetFiles[0]) ?? blocks[0]!.code
            yield* Effect.tryPromise(() => writeFile(targetFiles[0]!, best))
            return
        }

        // Multiple targets: match each file to its block
        let unmatched: string[] = []
        for (const targetFile of targetFiles) {
            const code = matchBlockToFile(blocks, targetFile)
            if (code !== null) {
                yield* Effect.tryPromise(() => writeFile(targetFile, code))
            } else {
                unmatched.push(targetFile)
            }
        }

        // Fallback: if exactly one block remains unassigned and one file unmatched, pair them
        if (unmatched.length === 1 && blocks.length === 1) {
            yield* Effect.tryPromise(() => writeFile(unmatched[0]!, blocks[0]!.code))
        }
    })
}

// ─── Code block extraction ────────────────────────────────────────────────────

function extractCodeBlocks(text: string): ExtractedBlock[] {
    const blocks: ExtractedBlock[] = []

    // Format 1: ```lang:filepath  (explicit filename in fence)
    // Format 2: ```lang           (language only, infer file from context)
    // Format 3: ```               (bare fence)
    const fenceRegex = /```(\w+)?(?::([^\n`]+))?\n([\s\S]*?)```/g
    let match: RegExpExecArray | null

    while ((match = fenceRegex.exec(text)) !== null) {
        const language = match[1]?.toLowerCase()
        const labelFilename = match[2]?.trim()
        const code = match[3]!.trimEnd()
        const isDiff = language === "diff"

        // Look in the 300 chars before the block for a filename mention
        const before = text.slice(Math.max(0, match.index - 300), match.index)
        const inferredFilename = labelFilename ?? inferFilenameFromContext(before)

        blocks.push({ filename: inferredFilename, language, code, isDiff })
    }

    return blocks
}

function inferFilenameFromContext(before: string): string | undefined {
    // Patterns: **src/file.ts**, `src/file.ts`, ## src/file.ts, File: src/file.ts
    const patterns = [
        /\*\*([^\s*]+\.[a-zA-Z]+)\*\*/,
        /`([^\s`]+\.[a-zA-Z]+)`/,
        /(?:file|path|update|edit|modify)[\s:]+([^\s]+\.[a-zA-Z]+)/i,
        /##\s+([^\s]+\.[a-zA-Z]+)/,
        /([^\s/]+\/[^\s]+\.[a-zA-Z]{1,5})\s*:?\s*$/m,
    ]
    for (const p of patterns) {
        const m = before.match(p)
        if (m?.[1]) return m[1]
    }
    return undefined
}

// ─── Block-to-file matching ───────────────────────────────────────────────────

const LANG_EXT_MAP: Record<string, string[]> = {
    typescript: ["ts", "tsx"],
    javascript: ["js", "jsx", "mjs", "cjs"],
    python:     ["py"],
    json:       ["json"],
    yaml:       ["yml", "yaml"],
    toml:       ["toml"],
    css:        ["css"],
    html:       ["html", "htm"],
    bash:       ["sh", "bash"],
    rust:       ["rs"],
    go:         ["go"],
}

function matchBlockToFile(blocks: ExtractedBlock[], targetFile: string): string | null {
    const targetBase = basename(targetFile)
    const targetExt  = extname(targetFile).replace(".", "").toLowerCase()

    // Pass 1: exact filename match (label has exact path or basename)
    for (const b of blocks) {
        if (!b.filename) continue
        if (
            b.filename === targetFile ||
            b.filename === targetBase ||
            targetFile.endsWith(b.filename) ||
            b.filename.endsWith(targetBase)
        ) {
            return b.code
        }
    }

    // Pass 2: partial path match (label contains the file's directory segment)
    for (const b of blocks) {
        if (!b.filename) continue
        const segments = targetFile.split("/")
        if (segments.some(seg => b.filename!.includes(seg) && seg.includes("."))) {
            return b.code
        }
    }

    // Pass 3: language extension match
    for (const b of blocks) {
        if (!b.language) continue
        const exts = LANG_EXT_MAP[b.language] ?? [b.language]
        if (exts.includes(targetExt)) {
            return b.code
        }
    }

    return null
}
