import { Effect, Exit } from "effect"
import { readFile, writeFile } from "fs/promises"
import { existsSync, readFileSync } from "fs"
import { basename, extname } from "path"
import { ensureParentDir } from "@monkeydcode/core/util/path"
import * as Sampler from "@monkeydcode/consistency/sampler"
import * as Retriever from "@monkeydcode/context/retriever"
import * as Capability from "@monkeydcode/consistency/model-capability/detector"
import { recordPassRate } from "@monkeydcode/consistency/model-capability/detector"
import * as Policy from "@monkeydcode/consistency/model-capability/policy"
import * as Telemetry from "@monkeydcode/consistency/telemetry"
import { loadConfig } from "@monkeydcode/core/mdc-config"
import {
    applyPatch,
    formatReadOutput,
    globalSnapshotStore,
    HASHLINE_EDIT_PROMPT,
    looksLikeHashlinePatch,
} from "@monkeydcode/hashline"
import { syntaxGateForFile } from "@monkeydcode/consistency/verification/syntax"
import type { Plan, PlanStep } from "./plan-agent.ts"
import type { ModelRef } from "@monkeydcode/llm"
import * as WorkingMemory from "./working-memory.ts"
import * as Status from "./status.ts"
import * as Changes from "./changes.ts"
import { assertCanWrite } from "./registry.ts"
import * as ToolLoop from "./tool-loop.ts"
import * as PreStepCheck from "./pre-step-check.ts"

export type { Plan, PlanStep }

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtractedBlock {
    filename?: string
    language?: string
    code: string
    isDiff: boolean
}

export interface ExecutePlanOptions {
    /** Skip test-first check generation (ROADMAP Phase 2 P2-3) for this plan's
     *  steps. Sub-agents that already have their own test contract — bugfix's
     *  repro test, refactor's behavior-preservation requirement — opt out so a
     *  second, generic check doesn't get generated alongside/in conflict with
     *  it. Defaults to enabled (false/undefined) for the generic plan path. */
    skipPreStepCheck?: boolean
}

// ─── Plan execution ───────────────────────────────────────────────────────────

export function executePlan(
    plan: Plan,
    model: ModelRef,
    modelId: string,
    options?: ExecutePlanOptions,
): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i]!
            Status.emit({
                agent: "franky",
                action: `Step ${i + 1}/${plan.steps.length}: ${step.description}`,
                plan,
                progress: { current: i + 1, total: plan.steps.length },
            })
            yield* executeStep(step, model, modelId, i, options)
        }
    })
}

function executeStep(
    step: PlanStep,
    model: ModelRef,
    modelId: string,
    index: number,
    options?: ExecutePlanOptions,
): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        assertCanWrite("build")
        const capabilityLevel = yield* Capability.detect(model)
        const config = yield* Effect.tryPromise(() => loadConfig())

        // Self-tuning (opt-in, ROADMAP Phase 2 P2-1): if this model has
        // verifiably done better with full-rewrite than hashline at line
        // counts the static threshold would still send to hashline, raise
        // the threshold for it specifically. Falls back to the static
        // FULL_REWRITE_LINE_THRESHOLD when tuning is off or there isn't
        // enough recorded evidence yet.
        let fullRewriteLineThreshold = FULL_REWRITE_LINE_THRESHOLD
        if (config.consistency.selfTuning) {
            const records = yield* Effect.promise(() => Telemetry.readAllForModel(modelId))
            const recommended = Policy.recommendFullRewriteThreshold(records, FULL_REWRITE_LINE_THRESHOLD)
            if (recommended !== null) fullRewriteLineThreshold = recommended
        }

        // Test-first (ROADMAP Phase 2 P2-3): generate an executable check for
        // this step's verificationCriteria BEFORE sampling the implementation,
        // confirm it's currently red, and let it ride along as a real project
        // file. No pipeline/sampler changes needed for this to matter — the
        // sampler's existing "tests" verification stage picks the new file up
        // automatically, so a failing check drives the exact same repair
        // loop as any other verification failure. Skipped for creative steps
        // (no meaningful behavioral assertion to write for a landing page)
        // and when the caller opts out (bugfix/refactor already have their
        // own test contract — see sub-agents/bugfix.ts, sub-agents/refactor.ts).
        // Best-effort via Effect.exit: run to an Exit and treat any non-success
        // (E-channel failure OR defect — the inner effect calls the model via
        // Effect.promise, whose rejection is a DEFECT) as "no check." Effect.catch
        // is wrong here twice over: it doesn't recover defects, and its 2-arg
        // form mis-resolves to a curried function that crashes on yield* in this
        // Effect build. A pre-step check must never crash the step it gates.
        let check: PreStepCheck.GeneratedCheck | null = null
        if (!step.creative && !options?.skipPreStepCheck) {
            const exit = yield* PreStepCheck.createPreStepCheck(
                step.description, step.verificationCriteria, step.targetFiles, model,
            ).pipe(Effect.exit)
            check = Exit.isSuccess(exit) ? exit.value : null
        }
        // Note: the check is NOT recorded as a produced change here — only after
        // the step passes (below). Recording it up front would leave the
        // orchestrator's change list pointing at a file that gets deleted on
        // failure, which full-verification would then fail to read.

        const context = yield* Retriever.retrieve(
            { files: step.targetFiles, description: step.description },
            { capabilityLevel },
        )

        // Recon: let the model look before it writes (real file reads, repo
        // search, diagnostics) instead of generating blind off a single
        // completion. Skipped for creative/greenfield artifacts (a landing
        // page has nothing meaningful to investigate) to avoid a wasted
        // round-trip where it can't help.
        const reconTranscript = step.creative
            ? ""
            : yield* gatherRecon(step, context, model)

        const checkContent = check
            ? yield* Effect.promise(() => readFile(check.path, "utf-8").catch(() => ""))
            : ""

        const prompt = buildExecutionPrompt(
            step, context, capabilityLevel, reconTranscript, fullRewriteLineThreshold, checkContent,
        )

        const result = yield* Sampler.sample({
            prompt,
            files: step.targetFiles,
            model,
            modelId,
            creative: step.creative,
        })

        // Hybrid escalation (ROADMAP Phase 2 P2-2): the sampler already
        // verified this came from the escalation model after the primary
        // model exhausted repair + resample — surface it rather than let it
        // look like the configured model just worked.
        if (result.escalatedTo) {
            Status.emit({
                agent: "franky",
                action: `Escalated step ${index + 1} to ${result.escalatedTo} — ${modelId} exhausted repair and resample`,
            })
        }

        yield* applyChange(result.selected.change, step.targetFiles)
        yield* Effect.tryPromise(() => recordPassRate(modelId, result.selected.verification.passed))

        if (check) {
            if (result.selected.verification.passed) {
                // The check passed and stays — report it as a produced change
                // (it's a real test the agent added, like bugfix.ts's repro).
                Changes.recordWrite(check.path)
            } else {
                // The step failed outright (score-0 give-up path) — remove the
                // check. A permanently-failing test must not be left behind when
                // the step it gated never landed; mirrors bugfix.ts's honesty
                // about unresolved fixes. (Not recorded above, so the
                // orchestrator's change list never points at this deleted path.)
                yield* PreStepCheck.removeCheck(check)
            }
        }

        yield* WorkingMemory.appendStep({
            index,
            confidence: result.confidence,
            description: step.description,
            files: step.targetFiles,
        })
    })
}

// ─── Recon ───────────────────────────────────────────────────────────────────

/**
 * Run the bounded tool loop once per step (not once per sampled candidate —
 * that would multiply cost by the temperature count for no extra benefit,
 * since all candidates should share the same grounding). Its literal "answer"
 * is discarded; only the accumulated Action/Observation transcript is kept
 * and folded into the real generation prompt below, which the existing
 * multi-candidate sampler still verifies and grades exactly as before.
 *
 * If the model never investigates (the common case for a fully-specified,
 * small step) this costs exactly one extra completion and returns "" —
 * degrading gracefully to the pre-recon behavior, not adding failure surface.
 */
function gatherRecon(
    step: PlanStep,
    context: Retriever.AssembledContext,
    model: ModelRef,
): Effect.Effect<string, unknown> {
    return Effect.gen(function* () {
        const reconPrompt = `${Retriever.formatForPrompt(context)}

## Task
${step.description}

## Target Files
${step.targetFiles.join("\n")}

Investigate using READ/GREP/RUN if it would help you understand the existing
code, project conventions, or related files before making this change. If you
already have everything you need, respond with a one-line summary of your
plan — do NOT write the final code in this step.`

        const projectRoot = Sampler.detectProjectRoot(step.targetFiles)
        // Best-effort via Effect.exit: the tool loop calls the model via
        // Effect.promise (rejection → DEFECT). Recon is optional — any
        // non-success degrades to "no transcript," never crashes the step.
        // (See the pre-step-check note above on why Effect.catch is wrong here.)
        const exit = yield* ToolLoop.run(reconPrompt, { model, projectRoot, maxIterations: 4 }).pipe(Effect.exit)
        const outcome = Exit.isSuccess(exit) ? exit.value : { finalText: "", transcript: "", iterations: 0 }
        return outcome.transcript
    })
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

/**
 * Show the model the CURRENT content of any target file that already exists,
 * with a real [path#TAG] hashline header. Without this, a step touching a file
 * created in an earlier turn/step is generated blind — the model has no idea
 * the file exists, what's in it, or what tag a hashline patch must reference,
 * so it either regenerates from scratch (destroying prior work) or emits a
 * hashline patch that fails tag validation.
 */
function readExistingTargets(files: string[]): string {
    const blocks: string[] = []
    for (const f of files) {
        if (!existsSync(f)) continue
        try {
            const content = readFileSync(f, "utf-8")
            const capped = content.length > 12_000
                ? content.slice(0, 12_000) + "\n… (truncated — file continues, re-read for more)"
                : content
            const { text } = formatReadOutput(f, capped, { store: globalSnapshotStore })
            blocks.push(text)
        } catch {
            // Unreadable (permissions, binary, etc.) — treat as if it doesn't exist.
        }
    }
    return blocks.length > 0
        ? `## Current Content of Existing Target Files — this already exists, this is an EDIT not a fresh create\n${blocks.join("\n\n")}`
        : ""
}

// Hashline's tag/range DSL is exactly the kind of format a weak model fumbles
// — one bad range number silently corrupts an edit. For capability level >= 5
// (weak models) and files small enough to regenerate wholesale, a full-file
// rewrite is unfumblable: there is no range arithmetic to get wrong. Strong
// models and large files keep hashline, where its surgical-edit efficiency
// (touch 3 lines of a 2000-line file, not resend it) actually matters.
const FULL_REWRITE_CAPABILITY_LEVEL = 5
const FULL_REWRITE_LINE_THRESHOLD = 150

function shouldUseFullRewrite(targetFiles: string[], capabilityLevel: number, lineThreshold: number): boolean {
    if (capabilityLevel < FULL_REWRITE_CAPABILITY_LEVEL) return false
    return targetFiles.every(f => {
        if (!existsSync(f)) return true
        try {
            return readFileSync(f, "utf-8").split("\n").length <= lineThreshold
        } catch {
            return false
        }
    })
}

function outputFormatSection(targetFiles: string[], capabilityLevel: number, lineThreshold: number): string {
    if (shouldUseFullRewrite(targetFiles, capabilityLevel, lineThreshold)) {
        return [
            "Output the COMPLETE contents of each target file — a full rewrite, not a patch.",
            "Use one ```lang:path/to/file fenced code block per file, containing the ENTIRE file.",
            "Preserve everything in the current content shown above that you were not asked to change.",
        ].join("\n")
    }
    return [
        HASHLINE_EDIT_PROMPT,
        "",
        "For EXISTING files shown above with a [path#TAG] header: output hashline patches in ```hashline fences referencing that exact tag (NOT full-file rewrites).",
        "For NEW files with no header above (they don't exist yet): use ```typescript:path/to/file.ts with complete contents.",
    ].join("\n")
}

function buildExecutionPrompt(
    step: PlanStep,
    context: Retriever.AssembledContext,
    capabilityLevel: number,
    reconTranscript: string,
    fullRewriteLineThreshold: number,
    checkContent: string,
): string {
    const fileList = step.targetFiles.join("\n")
    const existingContent = readExistingTargets(step.targetFiles)
    const recon = reconTranscript
        ? `\n\n## Investigation Findings (already gathered — do not re-investigate)\n${reconTranscript}`
        : ""
    // Test-first (ROADMAP Phase 2 P2-3): a real, currently-failing test the
    // implementation must satisfy. It's already a file in the project, so it
    // will be run as part of normal verification either way — showing it
    // here just lets the model target it directly instead of discovering it
    // only through a repair-loop failure.
    const check = checkContent
        ? `\n\n## Test To Satisfy (already written, currently failing — make it pass)\n\`\`\`\n${checkContent}\n\`\`\``
        : ""

    return `${Retriever.formatForPrompt(context)}${recon}${check}

${existingContent}

## Task
${step.description}

## Target Files
${fileList}

## Verification Criteria
${step.verificationCriteria}

## Output Format — CRITICAL
${outputFormatSection(step.targetFiles, capabilityLevel, fullRewriteLineThreshold)}

Target file paths:
${fileList}`
}

// ─── applyChange ─────────────────────────────────────────────────────────────

/** Write a file, creating any missing parent directories (supports new files). */
async function writeFileEnsuringDir(path: string, content: string): Promise<void> {
    await ensureParentDir(path)
    await writeFile(path, content, "utf-8")
    Changes.recordWrite(path)
}

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
                yield* Effect.tryPromise(() => writeFileEnsuringDir(targetFiles[0]!, change.trim()))
            }
            return
        }

        if (targetFiles.length === 1 && targetFiles[0]) {
            // Single target: use the best matching block, fall back to first
            const best = matchBlockToFile(blocks, targetFiles[0]) ?? blocks[0]!.code
            yield* Effect.tryPromise(() => writeFileEnsuringDir(targetFiles[0]!, best))
            return
        }

        // Multiple targets: match each file to its block
        let unmatched: string[] = []
        for (const targetFile of targetFiles) {
            const code = matchBlockToFile(blocks, targetFile)
            if (code !== null) {
                yield* Effect.tryPromise(() => writeFileEnsuringDir(targetFile, code))
            } else {
                unmatched.push(targetFile)
            }
        }

        // Fallback: if exactly one block remains unassigned and one file unmatched, pair them
        if (unmatched.length === 1 && blocks.length === 1) {
            yield* Effect.tryPromise(() => writeFileEnsuringDir(unmatched[0]!, blocks[0]!.code))
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

/**
 * Reconstruct file content from a hashline patch body when the target file does
 * not exist yet. A hashline patch is an *edit*; if the model emits one for a new
 * file, its `+` body lines are the intended file content.
 */
function contentFromPatchBody(patch: string): string {
    return patch
        .split("\n")
        .filter(l => l.startsWith("+"))
        .map(l => l.slice(1))
        .join("\n")
}

function applyHashlinePatches(patches: string[], targetFiles: string[]): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        for (const patch of patches) {
            const targetFile = resolvePatchPath(patch, targetFiles)
            if (!targetFile) continue

            // New file: a hashline edit can't apply to nothing — create it from
            // the patch body instead of failing with ENOENT.
            if (!existsSync(targetFile)) {
                yield* Effect.tryPromise(() =>
                    writeFileEnsuringDir(targetFile, contentFromPatchBody(patch)),
                )
                continue
            }

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

            yield* Effect.tryPromise(() => writeFileEnsuringDir(targetFile, result.content!))
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
