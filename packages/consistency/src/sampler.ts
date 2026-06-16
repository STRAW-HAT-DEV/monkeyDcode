import { Effect } from "effect"
import { readFile, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { basename, extname } from "path"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import * as Pipeline from "./verification/pipeline.ts"
import type { VerificationResult } from "./verification/types.ts"
import * as Capability from "./model-capability/detector.ts"
import { loadConfig } from "@monkeydcode/core/mdc-config"
import * as Grader from "./grader.ts"
import * as Voter from "./voter.ts"
import * as Feedback from "./feedback.ts"

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SamplingTask {
    prompt: string
    files: string[]
    model: ModelRef
    modelId: string
}

export interface Candidate {
    change: string
    temperature: number
    verification: VerificationResult
}

export interface SamplingResult {
    selected: Candidate & { rrpScore: number }
    confidence: number
}

// ─── Temperature sets by model capability level ───────────────────────────────

const TEMP_SETS: Record<number, number[]> = {
    1: [0.3],
    2: [0.3],
    3: [0.3, 0.5],
    4: [0.3, 0.5],
    5: [0.3, 0.4, 0.5, 0.6],
    6: [0.3, 0.4, 0.5, 0.6],
}

// Providers that serve a single model instance locally and process requests
// effectively one-at-a-time. Firing candidates concurrently at them leaves a
// queued connection idling, which can hit an OS-level socket timeout. For these
// we generate sequentially; cloud providers stay fully concurrent.
const SEQUENTIAL_PROVIDERS: ReadonlySet<string> = new Set(["ollama"])

function generationConcurrency(provider: string): number | "unbounded" {
    return SEQUENTIAL_PROVIDERS.has(provider) ? 1 : "unbounded"
}

// ─── Main sampling loop ───────────────────────────────────────────────────────

export function sample(task: SamplingTask, retries = 0): Effect.Effect<SamplingResult, unknown> {
    return Effect.gen(function* () {
        const config = yield* Effect.tryPromise(() => loadConfig())
        const maxRetries = config.consistency.maxRetries

        const level = yield* Capability.detect(task.modelId)
        const temps = TEMP_SETS[level] ?? [0.5]

        // Generate candidates (no file I/O yet). Concurrency is provider-aware:
        // local single-instance servers (e.g. Ollama) run sequentially to avoid
        // idle queued connections timing out; cloud providers run concurrently.
        const candidates = yield* Effect.all(
            temps.map(t => generateCandidate(task, t)),
            { concurrency: generationConcurrency(task.model.provider) },
        )

        // Verify sequentially — each verification writes to actual project files,
        // verifies tsc/lint/tests in real project context, then restores originals.
        // Cannot be concurrent: they'd corrupt each other's file writes.
        const verified: Candidate[] = []
        for (const c of candidates) {
            const result = yield* verifyCandidate(c, task.files)
            verified.push(result)
        }

        const passing = verified.filter(c => c.verification.passed)

        if (passing.length === 0) {
            if (retries >= maxRetries) {
                const best = verified.sort((a, b) => b.verification.score - a.verification.score)[0]!
                return { selected: { ...best, rrpScore: 0 }, confidence: 0 }
            }
            const errors = verified.flatMap(v => v.verification.errors)
            const retryPrompt = Feedback.buildRetryPrompt(task.prompt, errors)
            return yield* sample({ ...task, prompt: retryPrompt }, retries + 1)
        }

        const graded = yield* Effect.tryPromise(() =>
            Grader.gradeAll(passing.map(p => ({ ...p, files: task.files }))),
        )
        const selected = Voter.selectBest(graded)
        return { selected, confidence: selected.rrpScore }
    })
}

// ─── Candidate generation ─────────────────────────────────────────────────────

function generateCandidate(task: SamplingTask, temperature: number): Effect.Effect<Candidate, unknown> {
    return Effect.promise(() =>
        LLM.generateAsync({
            model: task.model,
            messages: [{ role: "user", content: task.prompt }],
            temperature,
        }).then(r => ({
            change: r.text,
            temperature,
            verification: null as unknown as VerificationResult,
        }))
    )
}

// ─── Candidate verification ───────────────────────────────────────────────────
// Write generated code to actual project files, run the full pipeline,
// then ALWAYS restore the originals — whether the pipeline passed or threw.

function verifyCandidate(candidate: Candidate, files: string[]): Effect.Effect<Candidate, unknown> {
    return Effect.tryPromise(async () => {
        const projectRoot = detectProjectRoot(files)

        // 1. Save original file contents so we can restore them
        const originals = await Promise.all(
            files.map(async f => ({
                file: f,
                content: existsSync(f) ? await readFile(f, "utf-8") : null,
            }))
        )

        try {
            // 2. Apply generated code to the actual target files
            await applyGeneratedCode(candidate.change, files)

            // 3. Run full verification pipeline against the real project
            const verification = await Pipeline.run(files, projectRoot)
            return { ...candidate, verification }
        } finally {
            // 4. Always restore originals, whether pipeline passed, failed, or threw
            await Promise.all(
                originals.map(async ({ file, content }) => {
                    if (content !== null) await writeFile(file, content)
                })
            )
        }
    })
}

// ─── Project root detection ───────────────────────────────────────────────────

function detectProjectRoot(files: string[]): string {
    if (files.length === 0) return process.cwd()
    const parts = files[0]!.split("/")
    for (let i = parts.length - 1; i > 0; i--) {
        const dir = parts.slice(0, i).join("/")
        if (existsSync(`${dir}/package.json`) || existsSync(`${dir}/tsconfig.json`)) {
            return dir
        }
    }
    return parts.slice(0, -1).join("/")
}

// ─── Code extraction (write generated code to target files) ───────────────────

async function applyGeneratedCode(change: string, targetFiles: string[]): Promise<void> {
    const blocks = extractCodeBlocks(change)

    if (blocks.length === 0) {
        // No code fences — write raw text to single-file target
        if (targetFiles.length === 1 && targetFiles[0]) {
            await writeFile(targetFiles[0], change.trim())
        }
        return
    }

    if (targetFiles.length === 1 && targetFiles[0]) {
        const best = matchBlockToFile(blocks, targetFiles[0]) ?? blocks[0]!.code
        await writeFile(targetFiles[0], best)
        return
    }

    // Multiple targets: match each to its block
    const unmatched: string[] = []
    for (const f of targetFiles) {
        const code = matchBlockToFile(blocks, f)
        if (code !== null) await writeFile(f, code)
        else unmatched.push(f)
    }

    // Fallback: one remaining unmatched file + one remaining block
    if (unmatched.length === 1 && blocks.length === 1) {
        await writeFile(unmatched[0]!, blocks[0]!.code)
    }
}

// ─── Code block extraction ────────────────────────────────────────────────────

interface CodeBlock {
    filename?: string
    language?: string
    code: string
}

function extractCodeBlocks(text: string): CodeBlock[] {
    const blocks: CodeBlock[] = []
    const fenceRegex = /```(\w+)?(?::([^\n`]+))?\n([\s\S]*?)```/g
    let match: RegExpExecArray | null

    while ((match = fenceRegex.exec(text)) !== null) {
        const language = match[1]?.toLowerCase()
        const labelFilename = match[2]?.trim()
        const code = match[3]!.trimEnd()
        const before = text.slice(Math.max(0, match.index - 300), match.index)
        const inferredFilename = labelFilename ?? inferFilenameFromContext(before)
        blocks.push({ filename: inferredFilename, language, code })
    }

    return blocks
}

function inferFilenameFromContext(before: string): string | undefined {
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

const LANG_EXT: Record<string, string[]> = {
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

function matchBlockToFile(blocks: CodeBlock[], targetFile: string): string | null {
    const targetBase = basename(targetFile)
    const targetExt  = extname(targetFile).replace(".", "").toLowerCase()

    // Pass 1: exact filename match
    for (const b of blocks) {
        if (!b.filename) continue
        if (
            b.filename === targetFile ||
            b.filename === targetBase ||
            targetFile.endsWith(b.filename) ||
            b.filename.endsWith(targetBase)
        ) return b.code
    }

    // Pass 2: partial path segment match
    for (const b of blocks) {
        if (!b.filename) continue
        const segments = targetFile.split("/")
        if (segments.some(seg => seg.includes(".") && b.filename!.includes(seg))) {
            return b.code
        }
    }

    // Pass 3: language → extension match
    for (const b of blocks) {
        if (!b.language) continue
        const exts = LANG_EXT[b.language] ?? [b.language]
        if (exts.includes(targetExt)) return b.code
    }

    return null
}
