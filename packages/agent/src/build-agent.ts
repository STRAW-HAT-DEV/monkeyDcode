import { Effect } from "effect"
import { readFile, writeFile } from "fs/promises"
import { basename, extname } from "path"
import * as Sampler from "@monkeydcode/consistency/sampler"
import * as Retriever from "@monkeydcode/context/retriever"
import * as Capability from "@monkeydcode/consistency/model-capability/detector"
import { recordPassRate } from "@monkeydcode/consistency/model-capability/detector"
import {
    applyPatch,
    globalSnapshotStore,
    HASHLINE_EDIT_PROMPT,
    looksLikeHashlinePatch,
} from "@monkeydcode/hashline"
import { syntaxGateForFile } from "@monkeydcode/consistency/verification/syntax"
import type { Plan, PlanStep } from "./plan-agent.ts"
import { resolveModel } from "./utils.ts"
import * as WorkingMemory from "./working-memory.ts"
import * as Status from "./status.ts"
import { assertCanWrite } from "./registry.ts"
import { wrapReAct } from "./react.ts"

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
            Status.emit({
                agent: "franky",
                action: `Step ${i + 1}/${plan.steps.length}: ${step.description}`,
                plan,
                progress: { current: i + 1, total: plan.steps.length },
            })
            yield* executeStep(step, modelId, i)
        }
    })
}

function executeStep(step: PlanStep, modelId: string, index: number): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        assertCanWrite("build")
        const capabilityLevel = yield* Capability.detect(modelId)

        const context = yield* Retriever.retrieve(
            { files: step.targetFiles, description: step.description },
            { capabilityLevel },
        )

        const prompt = wrapReAct(buildExecutionPrompt(step, context))
        const model = resolveModel(modelId)

        const result = yield* Sampler.sample({
            prompt,
            files: step.targetFiles,
            model,
            modelId,
        })

        yield* applyChange(result.selected.change, step.targetFiles)
        yield* Effect.tryPromise(() => recordPassRate(modelId, result.selected.verification.passed))

        yield* WorkingMemory.appendStep({ index, confidence: result.confidence })
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
${HASHLINE_EDIT_PROMPT}

For EXISTING files: output hashline patches in \`\`\`hashline fences (NOT full-file rewrites).
For NEW files only: use \`\`\`typescript:path/to/file.ts with complete contents.

Target file paths (use in [path#TAG] after read):
${fileList}`
}

// ─── applyChange ─────────────────────────────────────────────────────────────

export function applyChange(change: string, targetFiles: string[]): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        const hashlinePatches = extractHashlinePatches(change)
        if (hashlinePatches.length > 0) {
            yield* applyHashlinePatches(hashlinePatches, targetFiles)
            return
        }

        if (looksLikeHashlinePatch(change)) {
            yield* applyHashlinePatches([change.trim()], targetFiles)
            return
        }

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

function extractHashlinePatches(text: string): string[] {
    const patches: string[] = []
    const fenceRegex = /```hashline\n([\s\S]*?)```/g
    let match: RegExpExecArray | null
    while ((match = fenceRegex.exec(text)) !== null) {
        patches.push(match[1]!.trim())
    }
    return patches
}

function resolvePatchPath(patch: string, targetFiles: string[]): string | undefined {
    const header = /^\[([^\]#]+)#[0-9a-fA-F]{4}\]/m.exec(patch)
    if (!header) return targetFiles[0]
    const patchPath = header[1]!.trim()
    for (const target of targetFiles) {
        if (
            target === patchPath ||
            target.endsWith(patchPath) ||
            patchPath.endsWith(target) ||
            basename(target) === basename(patchPath)
        ) {
            return target
        }
    }
    return targetFiles[0]
}

function applyHashlinePatches(patches: string[], targetFiles: string[]): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        for (const patch of patches) {
            const targetFile = resolvePatchPath(patch, targetFiles)
            if (!targetFile) continue

            const existing = yield* Effect.tryPromise(() => readFile(targetFile, "utf-8"))
            const relPath = targetFile.replace(/\\/g, "/")
            globalSnapshotStore.record(relPath, existing)
            const result = yield* Effect.tryPromise(() =>
                applyPatch(
                    patch,
                    {
                        content: existing,
                        path: relPath,
                        verifyBeforeWrite: syntaxGateForFile(targetFile),
                    },
                    globalSnapshotStore,
                ),
            )

            if (!result.ok || result.content === undefined) {
                return yield* Effect.fail(
                    new Error(
                        `Hashline apply failed for ${targetFile}: ${result.error ?? "unknown"}${result.hint ? `\n${result.hint}` : ""}`,
                    ),
                )
            }

            yield* Effect.tryPromise(() => writeFile(targetFile, result.content!, "utf-8"))
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
