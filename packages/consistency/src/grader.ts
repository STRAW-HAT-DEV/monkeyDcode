import { distance } from "fastest-levenshtein"
import { treeSitter } from "@monkeydcode/python-bridge"
import type { VerificationResult } from "./verification/types.ts"

export interface GradedCandidate {
    change: string
    temperature: number
    verification: VerificationResult
    consistencyScore: number
    qualityScore: number
    rrpScore: number
}

export async function gradeAll(candidates: Array<{
    change: string
    temperature: number
    verification: VerificationResult
    files?: string[]
}>): Promise<GradedCandidate[]> {
    const normalized = await Promise.all(
        candidates.map(c => normalizeForComparison(c.change, c.files?.[0])),
    )
    return candidates.map((c, i) => grade(c, candidates, normalized[i]!, normalized))
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
