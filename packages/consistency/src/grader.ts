import { distance } from "fastest-levenshtein"
import { treeSitter } from "@monkeydcode/python-bridge"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef, ContentPart } from "@monkeydcode/llm"
import type { VerificationResult } from "./verification/types.ts"
import * as Screenshot from "./verification/screenshot.ts"

export interface GradedCandidate {
    change: string
    temperature: number
    verification: VerificationResult
    consistencyScore: number
    qualityScore: number
    rrpScore: number
}

export interface GradeOptions {
    /** Holistic/creative artifact (e.g. a landing page). Convergence-to-average
     *  is a correctness signal for mechanical tasks (5 bugfix attempts agreeing
     *  implies the agreed answer is right) and an anti-creativity bias for
     *  design/creative ones (5 designs SHOULD differ; the most "average" one
     *  is usually the blandest, not the best). Skip consistency scoring and
     *  judge quality via rubric instead of code-smell heuristics that don't
     *  apply to markup/design. */
    creative?: boolean
    /** Used for the LLM-based creative quality judge; omitted → falls back to
     *  the plain heuristic (still better than nothing, but can't judge taste). */
    model?: ModelRef
}

export async function gradeAll(candidates: Array<{
    change: string
    temperature: number
    verification: VerificationResult
    files?: string[]
}>, options: GradeOptions = {}): Promise<GradedCandidate[]> {
    if (options.creative) {
        return gradeCreative(candidates, options.model)
    }

    const normalized = await Promise.all(
        candidates.map(c => normalizeForComparison(c.change, c.files?.[0])),
    )
    return candidates.map((c, i) => grade(c, candidates, normalized[i]!, normalized))
}

// ─── Creative grading ──────────────────────────────────────────────────────

async function gradeCreative(
    candidates: Array<{ change: string; temperature: number; verification: VerificationResult }>,
    model?: ModelRef,
): Promise<GradedCandidate[]> {
    const qualityScores = await Promise.all(
        candidates.map(c => (model ? judgeCreativeQuality(c.change, model) : Promise.resolve(computeQuality(c.change)))),
    )
    return candidates.map((c, i) => {
        const verificationScore = c.verification.score
        const qualityScore = qualityScores[i]!
        // No consistency term: verification (does it actually parse/build) still
        // matters, but the deciding factor is judged quality, not averageness.
        const rrpScore = 0.5 * verificationScore + 0.5 * qualityScore
        return { ...c, consistencyScore: 1, qualityScore, rrpScore }
    })
}

const CREATIVE_RUBRIC =
    "Rate the following generated artifact from 0.0 to 1.0 on design/creative " +
    "quality: visual hierarchy, brand coherence, whitespace/layout balance, and " +
    "whether the copy feels intentional rather than generic placeholder text. " +
    "Do NOT reward genericness or blandness as \"safe\" — a distinctive, " +
    "well-composed result should score higher than a bland but conventional one. " +
    "Respond with ONLY a number between 0 and 1, nothing else."

function parseJudgeScore(text: string): number {
    const match = text.match(/(\d*\.?\d+)/)
    const score = match ? parseFloat(match[1]!) : NaN
    // Judge output didn't parse — neutral score. 0 would unfairly tank an
    // otherwise valid candidate; 1 would rubber-stamp everything.
    return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0.6
}

/** LLM-as-judge rubric score for design/creative output. Renders the artifact
 *  and judges the actual screenshot when possible (Playwright installed) —
 *  the only way to catch layout/visual problems no amount of reading markup
 *  reveals. Falls back to judging the raw source when rendering isn't
 *  available, which still beats the old code-smell heuristic (console.log
 *  counting) that had no bearing on design quality at all. */
async function judgeCreativeQuality(change: string, model: ModelRef): Promise<number> {
    const code = extractPrimaryCodeBlock(change)
    const looksLikeHtml = /<html[\s>]|<!DOCTYPE html/i.test(code)

    if (looksLikeHtml) {
        try {
            const screenshot = await Screenshot.screenshotHtml(code)
            // Not every model that generated the code can also judge an
            // image (a local text-only model, for instance) — if the vision
            // call fails for any reason, fall back to text judging rather
            // than a flat neutral score that would fail to differentiate
            // any of the candidates.
            if (screenshot) return await judgeVisual(screenshot, model)
        } catch {
            // fall through to text judging below
        }
    }

    try {
        return await judgeText(code, model)
    } catch {
        return 0.6
    }
}

async function judgeVisual(screenshot: Screenshot.Screenshot, model: ModelRef): Promise<number> {
    const content: ContentPart[] = [
        { type: "text", text: CREATIVE_RUBRIC },
        { type: "image", source: { type: "base64", mediaType: screenshot.mediaType, data: screenshot.base64 } },
    ]
    const response = await LLM.generateAsync({
        model,
        messages: [{ role: "user", content }],
        temperature: 0,
    })
    return parseJudgeScore(response.text)
}

async function judgeText(code: string, model: ModelRef): Promise<number> {
    const response = await LLM.generateAsync({
        model,
        messages: [{
            role: "user",
            content: `${CREATIVE_RUBRIC}\n\n\`\`\`\n${code.slice(0, 6000)}\n\`\`\``,
        }],
        temperature: 0,
    })
    return parseJudgeScore(response.text)
}

function grade(
    candidate: { change: string; temperature: number; verification: VerificationResult },
    all: Array<{ change: string; temperature: number; verification: VerificationResult }>,
    normalized: string,
    allNormalized: string[],
): GradedCandidate {
    const verificationScore = candidate.verification.score
    const consistencyScore = computeConsistency(normalized, allNormalized, all.indexOf(candidate))
    const qualityScore = computeQuality(candidate.change)

    const rrpScore = 0.5 * verificationScore +
                     0.3 * consistencyScore +
                     0.2 * qualityScore

    return { ...candidate, consistencyScore, qualityScore, rrpScore }
}

function computeConsistency(normalized: string, allNormalized: string[], selfIndex: number): number {
    if (allNormalized.length === 1) return 1.0
    const distances = allNormalized
        .filter((_, i) => i !== selfIndex)
        .map(other => normalizedDistance(normalized, other))
    const avg = distances.reduce((s, d) => s + d, 0) / distances.length
    return 1.0 - avg
}

function normalizedDistance(a: string, b: string): number {
    return Math.min(distance(a, b) / Math.max(a.length, b.length, 1), 1.0)
}

/** AST-normalize via tree-sitter when available; fall back to whitespace-stripped text. */
async function normalizeForComparison(change: string, _sampleFile?: string): Promise<string> {
    const code = extractPrimaryCodeBlock(change)
    const { writeFile, unlink } = await import("fs/promises")
    const { join } = await import("path")
    const { tmpdir } = await import("os")
    const tmp = join(tmpdir(), `mdc-ast-${Math.random().toString(36).slice(2)}.ts`)
    try {
        await writeFile(tmp, code)
        const ast = await treeSitter.parseAST(tmp)
        if (ast && ast.type !== "fallback") return JSON.stringify(ast)
    } catch { /* fall through */ } finally {
        await unlink(tmp).catch(() => undefined)
    }
    return code.replace(/\s+/g, " ").trim()
}

function extractPrimaryCodeBlock(text: string): string {
    const match = text.match(/```[\w:]*\n([\s\S]*?)```/)
    return match?.[1]?.trim() ?? text.trim()
}

function computeQuality(change: string): number {
    let score = 1.0
    if (change.includes("console.log")) score -= 0.2
    if (change.match(/\b\d{4,}\b/)) score -= 0.1
    if (!change.includes(":") && !change.includes("def ") && !change.includes("function")) score -= 0.1
    return Math.max(0, score)
}
