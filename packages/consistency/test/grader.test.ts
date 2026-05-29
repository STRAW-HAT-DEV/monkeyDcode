import { expect, test } from "bun:test"
import { gradeAll } from "../src/grader.ts"
import type { Candidate } from "../src/sampler.ts"

function candidate(change: string): Candidate {
    return {
        change,
        temperature: 0.3,
        verification: { passed: true, stage: "complete", score: 1, errors: [], durationMs: 1, stages: {} },
    }
}

test("a single candidate gets consistency 1.0 and rrp 1.0", () => {
    const [g] = gradeAll([candidate("const x: number = 1")])
    expect(g!.consistencyScore).toBe(1.0)
    expect(g!.rrpScore).toBeCloseTo(1.0)
})

test("console.log penalizes the quality score", () => {
    const [g] = gradeAll([candidate("console.log('x'): number")])
    expect(g!.qualityScore).toBeLessThan(1.0)
})

test("identical candidates rank equally", () => {
    const graded = gradeAll([candidate("const a: number = 1"), candidate("const a: number = 1")])
    expect(graded[0]!.rrpScore).toBeCloseTo(graded[1]!.rrpScore)
})

test("gradeAll preserves the input length", () => {
    expect(gradeAll([candidate("a:1"), candidate("b:2"), candidate("c:3")])).toHaveLength(3)
})
