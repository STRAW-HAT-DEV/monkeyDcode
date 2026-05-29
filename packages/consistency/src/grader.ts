// EXPERIMENTAL: ranks verified candidates by a Reliability-Risk-Penalty (RRP)
// score: verification weight + cross-candidate consistency + cheap quality heuristics.

import { distance } from "fastest-levenshtein"
import type { Candidate, GradedCandidate } from "./sampler.ts"

const WEIGHTS = { verification: 0.5, consistency: 0.3, quality: 0.2 } as const

export function gradeAll(candidates: Candidate[]): GradedCandidate[] {
    return candidates.map((c) => grade(c, candidates))
}

function grade(candidate: Candidate, all: Candidate[]): GradedCandidate {
    const verificationScore = candidate.verification.score
    const consistencyScore = computeConsistency(candidate, all)
    const qualityScore = computeQuality(candidate.change)

    const rrpScore =
        WEIGHTS.verification * verificationScore +
        WEIGHTS.consistency * consistencyScore +
        WEIGHTS.quality * qualityScore

    return { ...candidate, consistencyScore, qualityScore, rrpScore }
}

function computeConsistency(candidate: Candidate, all: Candidate[]): number {
    if (all.length === 1) return 1.0
    const distances = all.filter((c) => c !== candidate).map((c) => normalizedDistance(candidate.change, c.change))
    const avg = distances.reduce((s, d) => s + d, 0) / distances.length
    return 1.0 - avg
}

function normalizedDistance(a: string, b: string): number {
    return Math.min(distance(a, b) / Math.max(a.length, b.length, 1), 1.0)
}

function computeQuality(change: string): number {
    let score = 1.0
    if (change.includes("console.log")) score -= 0.2
    if (change.match(/\b\d{4,}\b/)) score -= 0.1
    if (!change.includes(":")) score -= 0.1
    return Math.max(0, score)
}
