import { test, expect } from "bun:test"
import {
    recommendTemperatures,
    recommendRepairBudget,
    recommendFullRewriteThreshold,
} from "../src/model-capability/policy.ts"
import type { SampleTelemetry, ChangeFormat } from "../src/telemetry.ts"

function record(overrides: Partial<SampleTelemetry> = {}): SampleTelemetry {
    return {
        timestamp: new Date().toISOString(),
        modelId: "test-model",
        provider: "ollama",
        capabilityLevel: 5,
        creative: false,
        temperatures: [0.3, 0.5],
        repairAttempts: [0, 0],
        verificationScores: [1, 1],
        verificationPassed: [true, true],
        formats: ["full-rewrite", "full-rewrite"],
        resampleRetries: 0,
        selectedTemperature: 0.3,
        selectedScore: 0.9,
        confidence: 0.9,
        passed: true,
        durationMs: 1000,
        ...overrides,
    }
}

// ─── recommendTemperatures ──────────────────────────────────────────────────

const FULL_TEMPS = [0.3, 0.4, 0.5, 0.6]

test("recommendTemperatures returns null with too few samples", () => {
    const records = Array.from({ length: 5 }, () => record({ temperatures: FULL_TEMPS, verificationPassed: [true, true, true, true] }))
    expect(recommendTemperatures(records, FULL_TEMPS)).toBeNull()
})

test("recommendTemperatures shifts sampling toward the best temp when one clearly underperforms", () => {
    // 0.3 always passes; 0.6 always fails — 0.6 should be replaced by a
    // duplicate of 0.3, while the distribution keeps >= 2 distinct temps.
    const records = Array.from({ length: 25 }, () =>
        record({ temperatures: FULL_TEMPS, verificationPassed: [true, true, true, false] }),
    )
    const result = recommendTemperatures(records, FULL_TEMPS)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(FULL_TEMPS.length) // cardinality preserved
    expect(result).not.toContain(0.6)              // the loser is dropped
    expect(new Set(result!).size).toBeGreaterThanOrEqual(2) // never collapses
    expect(result!.filter(t => t === 0.3).length).toBeGreaterThan(1) // best duplicated
})

test("recommendTemperatures returns null (no change) when all temps perform similarly", () => {
    const records = Array.from({ length: 25 }, () =>
        record({ temperatures: FULL_TEMPS, verificationPassed: [true, true, true, true] }),
    )
    expect(recommendTemperatures(records, FULL_TEMPS)).toBeNull()
})

test("recommendTemperatures ignores creative records", () => {
    const records = Array.from({ length: 25 }, () => record({ creative: true, temperatures: FULL_TEMPS, verificationPassed: [true, true, true, false] }))
    expect(recommendTemperatures(records, FULL_TEMPS)).toBeNull()
})

test("recommendTemperatures never collapses a 2-temp static set below 2 distinct", () => {
    // With only 2 distinct static temps, replacing the loser would leave 1
    // distinct — so it must decline and return null rather than collapse.
    const records = Array.from({ length: 25 }, () =>
        record({ temperatures: [0.3, 0.5], verificationPassed: [true, false] }),
    )
    expect(recommendTemperatures(records, [0.3, 0.5])).toBeNull()
})

// ─── recommendRepairBudget ───────────────────────────────────────────────────

test("recommendRepairBudget returns null with too few repaired candidates", () => {
    const records = Array.from({ length: 5 }, () => record({ repairAttempts: [1] }))
    expect(recommendRepairBudget(records, 2)).toBeNull()
})

test("recommendRepairBudget increases the budget when repair pays off often", () => {
    const records = Array.from({ length: 25 }, () =>
        record({ repairAttempts: [1], verificationPassed: [true] }),
    )
    expect(recommendRepairBudget(records, 2)).toBe(3)
})

test("recommendRepairBudget caps the increase at 3", () => {
    const records = Array.from({ length: 25 }, () =>
        record({ repairAttempts: [1], verificationPassed: [true] }),
    )
    expect(recommendRepairBudget(records, 3)).toBe(3)
})

test("recommendRepairBudget decreases the budget when repair rarely helps", () => {
    const records = Array.from({ length: 25 }, () =>
        record({ repairAttempts: [2], verificationPassed: [false] }),
    )
    expect(recommendRepairBudget(records, 2)).toBe(1)
})

test("recommendRepairBudget floors the decrease at 1", () => {
    const records = Array.from({ length: 25 }, () =>
        record({ repairAttempts: [1], verificationPassed: [false] }),
    )
    expect(recommendRepairBudget(records, 1)).toBe(1)
})

test("recommendRepairBudget returns null for a middling success rate", () => {
    const records = Array.from({ length: 25 }, (_, i) =>
        record({ repairAttempts: [1], verificationPassed: [i % 2 === 0] }),
    )
    expect(recommendRepairBudget(records, 2)).toBeNull()
})

// ─── recommendFullRewriteThreshold ──────────────────────────────────────────

function formatRecord(formats: ChangeFormat[], passed: boolean[]): SampleTelemetry {
    return record({ formats, verificationPassed: passed, temperatures: formats.map(() => 0.3), repairAttempts: formats.map(() => 0) })
}

test("recommendFullRewriteThreshold returns null with too few observations of either format", () => {
    const records = [formatRecord(["hashline"], [false]), formatRecord(["full-rewrite"], [true])]
    expect(recommendFullRewriteThreshold(records, 150)).toBeNull()
})

test("recommendFullRewriteThreshold raises the threshold when full-rewrite clearly outperforms hashline", () => {
    const records = [
        ...Array.from({ length: 5 }, () => formatRecord(["hashline"], [false])),
        ...Array.from({ length: 5 }, () => formatRecord(["full-rewrite"], [true])),
    ]
    expect(recommendFullRewriteThreshold(records, 150)).toBe(300)
})

test("recommendFullRewriteThreshold returns null when both formats perform similarly", () => {
    const records = [
        ...Array.from({ length: 5 }, () => formatRecord(["hashline"], [true])),
        ...Array.from({ length: 5 }, () => formatRecord(["full-rewrite"], [true])),
    ]
    expect(recommendFullRewriteThreshold(records, 150)).toBeNull()
})

test("recommendFullRewriteThreshold never lowers the threshold when hashline outperforms full-rewrite", () => {
    const records = [
        ...Array.from({ length: 5 }, () => formatRecord(["hashline"], [true])),
        ...Array.from({ length: 5 }, () => formatRecord(["full-rewrite"], [false])),
    ]
    expect(recommendFullRewriteThreshold(records, 150)).toBeNull()
})
