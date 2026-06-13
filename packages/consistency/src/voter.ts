import type { GradedCandidate } from "./grader.ts"

/** Select the highest RRP-scoring verified candidate. */
export function selectBest(graded: GradedCandidate[]): GradedCandidate {
    if (graded.length === 0) {
        throw new Error("voter.selectBest: no candidates to select from")
    }
    return [...graded].sort((a, b) => b.rrpScore - a.rrpScore)[0]!
}

/** Pairwise agreement among passing candidates (for benchmarks). */
export function averagePairwiseScore(candidates: GradedCandidate[]): number {
    if (candidates.length <= 1) return 1
    let sum = 0
    let count = 0
    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            sum += (candidates[i]!.consistencyScore + candidates[j]!.consistencyScore) / 2
            count++
        }
    }
    return count > 0 ? sum / count : 1
}
