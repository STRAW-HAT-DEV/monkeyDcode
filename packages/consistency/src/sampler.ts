import { Effect, Exit } from "effect"
import { readFile, writeFile, mkdir, rm } from "fs/promises"
import { existsSync } from "fs"
import { basename, extname, dirname, isAbsolute, join, resolve } from "path"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { resolveModel } from "@monkeydcode/llm/resolve-model"
import * as Pipeline from "./verification/pipeline.ts"
import type { VerificationResult } from "./verification/types.ts"
import * as Capability from "./model-capability/detector.ts"
import { loadConfig } from "@monkeydcode/core/mdc-config"
import * as Grader from "./grader.ts"
import * as Voter from "./voter.ts"
import * as Feedback from "./feedback.ts"
import * as Telemetry from "./telemetry.ts"
import * as Policy from "./model-capability/policy.ts"

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SamplingTask {
    prompt: string
    files: string[]
    model: ModelRef
    modelId: string
    /** Holistic/creative artifact (e.g. a landing page). Uses higher temperature
     *  for real diversity across samples and grades by judged quality instead
     *  of convergence-to-average — see grader.ts. */
    creative?: boolean
}

export interface Candidate {
    change: string
    temperature: number
    verification: VerificationResult
}

export interface SamplingResult {
    selected: Candidate & { rrpScore: number }
    confidence: number
    /** Set when this result came from the escalation model (ROADMAP Phase 2,
     *  P2-2), not the primary task.model — lets callers report "escalated
     *  step N to <model>" instead of silently attributing the win to the
     *  local model that actually exhausted repair + resample on it. */
    escalatedTo?: string
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

// Creative/holistic tasks (landing pages, etc.) want real diversity, not
// convergence — low temperature just makes every candidate the same bland
// output. Every level gets multiple higher-temperature samples here, including
// levels 1-2, which otherwise get a single temp=0.3 shot and no sampling
// benefit at all.
const CREATIVE_TEMP_SETS: Record<number, number[]> = {
    1: [0.7, 0.9],
    2: [0.7, 0.9],
    3: [0.7, 0.85, 1.0],
    4: [0.7, 0.85, 1.0],
    5: [0.7, 0.85, 1.0],
    6: [0.7, 0.85, 1.0],
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
        const start = Date.now()
        const config = yield* Effect.tryPromise(() => loadConfig())
        const maxRetries = config.consistency.maxRetries
        let maxRepairAttempts = config.consistency.maxRepairAttempts

        const level = yield* Capability.detect(task.model)
        let temps = task.creative
            ? (CREATIVE_TEMP_SETS[level] ?? [0.8])
            : (TEMP_SETS[level] ?? [0.5])

        // Self-tuning (opt-in — config.consistency.selfTuning, ROADMAP Phase 2
        // P2-1): once enough samples are recorded for THIS exact model, prefer
        // what has actually worked over the static tables tuned in the
        // abstract for "a level-N model." Skipped for creative tasks (their
        // temperature spread serves a different purpose — see
        // CREATIVE_TEMP_SETS) and for retries (the prompt has already been
        // rewritten with error context by then; re-tuning mid-retry-chain
        // adds telemetry reads for no benefit).
        if (config.consistency.selfTuning && !task.creative && retries === 0) {
            const records = yield* Effect.promise(() => Telemetry.readAllForModel(task.modelId))
            const recommendedTemps = Policy.recommendTemperatures(records, temps)
            if (recommendedTemps) temps = recommendedTemps
            const recommendedRepair = Policy.recommendRepairBudget(records, maxRepairAttempts)
            if (recommendedRepair !== null) maxRepairAttempts = recommendedRepair
        }

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

        // Repair loop: a candidate that fails verification gets fed its OWN exact
        // errors and asked for a minimal fix, re-verified, up to maxRepairAttempts
        // times — before ever being discarded for a full resample. This is far
        // cheaper and more reliable than restarting from scratch, especially for
        // weak models (fixing a named error in code you just wrote is an easier
        // task than producing correct code unaided on the first try).
        const repaired: Candidate[] = []
        const repairAttempts: number[] = []
        for (const c of verified) {
            if (c.verification.passed) {
                repaired.push(c)
                repairAttempts.push(0)
                continue
            }
            const { candidate, attempts } = yield* repairCandidate(c, task, maxRepairAttempts)
            repaired.push(candidate)
            repairAttempts.push(attempts)
        }

        const passing = repaired.filter(c => c.verification.passed)
        const formats = repaired.map(c => Telemetry.detectChangeFormat(c.change))

        if (passing.length === 0) {
            if (retries >= maxRetries) {
                const best = repaired.sort((a, b) => b.verification.score - a.verification.score)[0]!
                yield* Effect.promise(() => Telemetry.record({
                    timestamp: new Date().toISOString(),
                    modelId: task.modelId,
                    provider: task.model.provider,
                    capabilityLevel: level,
                    creative: task.creative ?? false,
                    temperatures: temps,
                    repairAttempts,
                    verificationScores: repaired.map(c => c.verification.score),
                    verificationPassed: repaired.map(c => c.verification.passed),
                    formats,
                    resampleRetries: retries,
                    selectedTemperature: best.temperature,
                    selectedScore: 0,
                    confidence: 0,
                    passed: false,
                    durationMs: Date.now() - start,
                }))

                // Hybrid escalation (opt-in, ROADMAP Phase 2 P2-2): the local
                // model has now exhausted repair AND resample — a verified
                // failure, not a guess — so this is the one signal that
                // justifies spending on a stronger configured model. One
                // attempt only; if it also fails, give up exactly as before.
                if (config.escalation.enabled && config.escalation.provider && config.escalation.model) {
                    // Best-effort via Effect.exit: attemptEscalation can fail by
                    // a synchronous throw (resolveModel on an unknown provider)
                    // or an Effect.promise rejection (unreachable model / API
                    // error) — both DEFECTS. Effect.catch would neither recover
                    // them nor even compose (its 2-arg form mis-resolves to a
                    // curried function that crashes on yield* in this Effect
                    // build). A misconfigured/unreachable escalation model must
                    // fall back to the normal give-up path, never crash the task.
                    const exit = yield* attemptEscalation(task, config.escalation).pipe(Effect.exit)
                    const escalated = Exit.isSuccess(exit) ? exit.value : null
                    if (escalated) {
                        yield* Effect.promise(() => Telemetry.record({
                            timestamp: new Date().toISOString(),
                            modelId: config.escalation.model,
                            provider: config.escalation.provider,
                            capabilityLevel: level,
                            creative: task.creative ?? false,
                            temperatures: [0.3],
                            repairAttempts: [0],
                            verificationScores: [escalated.verification.score],
                            verificationPassed: [escalated.verification.passed],
                            formats: [Telemetry.detectChangeFormat(escalated.change)],
                            resampleRetries: 0,
                            selectedTemperature: escalated.temperature,
                            selectedScore: escalated.rrpScore,
                            confidence: escalated.rrpScore,
                            passed: true,
                            durationMs: Date.now() - start,
                        }))
                        return {
                            selected: escalated,
                            confidence: escalated.rrpScore,
                            escalatedTo: `${config.escalation.provider}/${config.escalation.model}`,
                        }
                    }
                }

                return { selected: { ...best, rrpScore: 0 }, confidence: 0 }
            }
            const errors = repaired.flatMap(v => v.verification.errors)
            const retryPrompt = Feedback.buildRetryPrompt(task.prompt, errors)
            return yield* sample({ ...task, prompt: retryPrompt }, retries + 1)
        }

        const graded = yield* Effect.tryPromise(() =>
            Grader.gradeAll(
                passing.map(p => ({ ...p, files: task.files })),
                { creative: task.creative, model: task.model },
            ),
        )
        const selected = Voter.selectBest(graded)

        yield* Effect.promise(() => Telemetry.record({
            timestamp: new Date().toISOString(),
            modelId: task.modelId,
            provider: task.model.provider,
            capabilityLevel: level,
            creative: task.creative ?? false,
            temperatures: temps,
            repairAttempts,
            verificationScores: repaired.map(c => c.verification.score),
            verificationPassed: repaired.map(c => c.verification.passed),
            formats,
            resampleRetries: retries,
            selectedTemperature: selected.temperature,
            selectedScore: selected.rrpScore,
            confidence: selected.rrpScore,
            passed: true,
            durationMs: Date.now() - start,
        }))

        return { selected, confidence: selected.rrpScore }
    })
}

// ─── Hybrid escalation ──────────────────────────────────────────────────────

/**
 * One attempt on the configured escalation model, only ever reached after the
 * primary model has exhausted repair AND resample — i.e. after a verified
 * failure, not a hunch. A single candidate at a conservative temperature is
 * sampled (strong models don't need multi-candidate voting the way weak ones
 * do), verified through the exact same pipeline, and graded like any other
 * candidate so its rrpScore is comparable. Returns null on any failure
 * (unreachable provider, bad model id, verification still fails) so the
 * caller falls back to the pre-escalation give-up path unchanged.
 */
function attemptEscalation(
    task: SamplingTask,
    escalation: { provider: string; model: string },
): Effect.Effect<(Candidate & { rrpScore: number }) | null, unknown> {
    return Effect.gen(function* () {
        const escalationModel = resolveModel(escalation.provider, escalation.model)
        const candidate = yield* generateCandidate({ ...task, model: escalationModel }, 0.3)
        const verified = yield* verifyCandidate(candidate, task.files)
        if (!verified.verification.passed) return null

        const graded = yield* Effect.tryPromise(() =>
            Grader.gradeAll(
                [{ ...verified, files: task.files }],
                { creative: task.creative, model: escalationModel },
            ),
        )
        return Voter.selectBest(graded)
    })
}

// ─── Self-repair ────────────────────────────────────────────────────────────

/** Repeatedly ask the model to fix ITS OWN failing output against its exact
 *  verification errors, re-verifying after each attempt. Stops early on first
 *  pass; returns the last attempt (even if still failing) after exhausting
 *  maxAttempts so the caller always has a real candidate to fall back on. */
function repairCandidate(
    candidate: Candidate,
    task: SamplingTask,
    maxAttempts: number,
): Effect.Effect<{ candidate: Candidate; attempts: number }, unknown> {
    return Effect.gen(function* () {
        let current = candidate
        let attempts = 0
        for (; attempts < maxAttempts && !current.verification.passed; attempts++) {
            const repairPrompt = Feedback.buildRepairPrompt(current.change, current.verification.errors)
            const repairedChange = yield* Effect.promise(() =>
                LLM.generateAsync({
                    model: task.model,
                    messages: [{ role: "user", content: repairPrompt }],
                    temperature: current.temperature,
                }).then(r => r.text),
            )
            current = yield* verifyCandidate(
                { change: repairedChange, temperature: current.temperature, verification: null as unknown as VerificationResult },
                task.files,
            )
        }
        return { candidate: current, attempts }
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
            // 4. Always restore originals, whether pipeline passed, failed, or threw.
            //    Files that didn't exist before are removed so the pre-verification
            //    state is fully restored (the final applyChange recreates them).
            await Promise.all(
                originals.map(async ({ file, content }) => {
                    if (content !== null) await writeFile(file, content)
                    else if (existsSync(file)) await rm(file, { force: true })
                })
            )
        }
    })
}

// ─── Project root detection ───────────────────────────────────────────────────

/** Nearest ancestor of `files[0]` containing package.json/tsconfig.json, else
 *  process.cwd(). Exported so other components (the tool loop, pre-step checks)
 *  that need "the project root for this task" use the exact same rule instead
 *  of a second, divergent one.
 *
 *  Relative target paths (e.g. "src/math.ts" — the common case when a plan
 *  step names files relative to the working directory) are resolved against
 *  process.cwd() first. The previous string-split walk returned the file's
 *  parent segment ("src") when no manifest was found, which pointed
 *  verification (`bun test`/`tsc`) at the wrong directory and mis-placed
 *  generated check files (e.g. nested "src/test/test/"). Falling back to
 *  process.cwd() — the actual working directory — is always a valid root. */
export function detectProjectRoot(files: string[]): string {
    const first = files[0]
    if (!first) return process.cwd()

    let dir = dirname(isAbsolute(first) ? first : resolve(process.cwd(), first))
    while (true) {
        if (existsSync(join(dir, "package.json")) || existsSync(join(dir, "tsconfig.json"))) {
            return dir
        }
        const parent = dirname(dir)
        if (parent === dir) break // reached the filesystem root
        dir = parent
    }
    return process.cwd()
}

// ─── Code extraction (write generated code to target files) ───────────────────

/** Write a file, creating any missing parent directories (supports new files). */
async function writeFileEnsuringDir(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
}

async function applyGeneratedCode(change: string, targetFiles: string[]): Promise<void> {
    const blocks = extractCodeBlocks(change)

    if (blocks.length === 0) {
        // No code fences — write raw text to single-file target
        if (targetFiles.length === 1 && targetFiles[0]) {
            await writeFileEnsuringDir(targetFiles[0], change.trim())
        }
        return
    }

    if (targetFiles.length === 1 && targetFiles[0]) {
        const best = matchBlockToFile(blocks, targetFiles[0]) ?? blocks[0]!.code
        await writeFileEnsuringDir(targetFiles[0], best)
        return
    }

    // Multiple targets: match each to its block
    const unmatched: string[] = []
    for (const f of targetFiles) {
        const code = matchBlockToFile(blocks, f)
        if (code !== null) await writeFileEnsuringDir(f, code)
        else unmatched.push(f)
    }

    // Fallback: one remaining unmatched file + one remaining block
    if (unmatched.length === 1 && blocks.length === 1) {
        await writeFileEnsuringDir(unmatched[0]!, blocks[0]!.code)
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
