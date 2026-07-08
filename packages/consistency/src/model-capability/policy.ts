/**
 * Self-tuning policy — ROADMAP.md Phase 2, P2-1.
 *
 * `TEMP_SETS`, the repair budget, and the full-rewrite line threshold are all
 * static tables tuned once, in the abstract, for "a level-N model." Telemetry
 * (telemetry.ts) already records what actually happened for THIS specific
 * model on THIS machine — which temperatures won, whether repair attempts
 * paid off, whether hashline or full-rewrite passed verification more often.
 * This module turns that history into recommendations that override the
 * static tables once there's enough evidence, and returns `null` for anything
 * it doesn't have enough data to recommend — callers always have a safe
 * static fallback.
 *
 * Single responsibility: read history, recommend. It does not decide whether
 * self-tuning is enabled (that's a config concern — see mdc-config.ts's
 * `consistency.selfTuning`, opt-in and off by default) and does not touch
 * the sampler's control flow (that's sampler.ts's job, which consumes this
 * as a pure function of modelId).
 */
import type { ChangeFormat, SampleTelemetry } from "../telemetry.ts"

// Minimum total recorded samples for a model before ANY override engages —
// below this, noise dominates signal and static defaults are safer.
const MIN_TOTAL_SAMPLES = 20
// Minimum observations of a specific value (a temperature, a format) before
// its pass rate is trusted enough to act on.
const MIN_OBSERVATIONS_PER_VALUE = 3

// ─── Temperature recommendation ─────────────────────────────────────────────

interface Stat {
    attempts: number
    passes: number
}

function passRate(s: Stat): number {
    return s.attempts === 0 ? 0 : s.passes / s.attempts
}

function roundTemp(t: number): number {
    return Math.round(t * 100) / 100
}

/**
 * Shift the sampling distribution toward temperatures that have actually
 * performed better for THIS model, while keeping candidate count fixed (so the
 * sampler's concurrency and voting are unaffected).
 *
 * Mechanism: a temperature whose historical pass rate trails the best by a wide
 * margin is replaced with a DUPLICATE of the best performer. Two candidates at
 * one temperature still sample independently (generation is stochastic), so
 * this is pure exploitation with no downside to the pipeline — but it is
 * deliberately CONSERVATIVE: it requires a large gap and always keeps at least
 * two distinct temperatures, so voting can never collapse to a single setting.
 * Returns null when there is no clear signal (the common case), leaving the
 * static set untouched.
 *
 * (An earlier version re-sorted the qualifying temps but always refilled the
 * result back to the exact static set — a guaranteed no-op. This version
 * genuinely changes the distribution or returns null; the tests assert the
 * shift actually happens.)
 */
export function recommendTemperatures(records: SampleTelemetry[], staticDefault: number[]): number[] | null {
    const nonCreative = records.filter(r => !r.creative)
    if (nonCreative.length < MIN_TOTAL_SAMPLES) return null

    const distinctStatic = [...new Set(staticDefault.map(roundTemp))]
    if (distinctStatic.length < 2) return null // can't preserve ≥2 distinct

    const stats = new Map<number, Stat>()
    for (const r of nonCreative) {
        for (let i = 0; i < r.temperatures.length; i++) {
            const t = roundTemp(r.temperatures[i]!)
            const s = stats.get(t) ?? { attempts: 0, passes: 0 }
            s.attempts++
            if (r.verificationPassed[i]) s.passes++
            stats.set(t, s)
        }
    }

    // Only reason about temperatures in the static set that have enough
    // observations to trust.
    const rated = distinctStatic
        .map(t => ({ t, rate: passRate(stats.get(t) ?? { attempts: 0, passes: 0 }), obs: stats.get(t)?.attempts ?? 0 }))
        .filter(x => x.obs >= MIN_OBSERVATIONS_PER_VALUE)
        .sort((a, b) => b.rate - a.rate)
    if (rated.length < 2) return null

    const best = rated[0]!
    const GAP = 0.4
    // Temperatures trailing the best by ≥ GAP are candidates for replacement,
    // worst-first, but never so many that fewer than 2 distinct temps remain.
    const poorWorstFirst = rated
        .filter(x => x.t !== best.t && best.rate - x.rate >= GAP)
        .sort((a, b) => a.rate - b.rate)
        .map(x => x.t)
    if (poorWorstFirst.length === 0) return null

    const toReplace = new Set<number>()
    for (const t of poorWorstFirst) {
        const remainingDistinct = distinctStatic.filter(d => !toReplace.has(d)).length
        if (remainingDistinct <= 2) break // keep at least 2 distinct temps
        toReplace.add(t)
    }
    if (toReplace.size === 0) return null

    return staticDefault.map(t => (toReplace.has(roundTemp(t)) ? best.t : t))
}

// ─── Repair budget recommendation ───────────────────────────────────────────

/**
 * Repair only has two useful directions to move: if repair attempts are
 * paying off most of the time, a bit more budget is worth the cost; if they
 * rarely rescue a candidate, spending less on repair (and resampling sooner)
 * is the better trade. Bounded to [1, 3] regardless of the recommendation —
 * this is a nudge, not an unbounded escalation.
 */
export function recommendRepairBudget(records: SampleTelemetry[], staticDefault: number): number | null {
    let repaired = 0
    let repairedAndPassed = 0
    for (const r of records) {
        for (let i = 0; i < r.repairAttempts.length; i++) {
            if ((r.repairAttempts[i] ?? 0) === 0) continue
            repaired++
            if (r.verificationPassed[i]) repairedAndPassed++
        }
    }
    if (repaired < MIN_TOTAL_SAMPLES) return null

    const rate = repairedAndPassed / repaired
    if (rate >= 0.7) return Math.min(3, staticDefault + 1)
    if (rate <= 0.2) return Math.max(1, staticDefault - 1)
    return null
}

// ─── Full-rewrite threshold recommendation ─────────────────────────────────

/**
 * If hashline is verifiably failing more often than full-rewrite FOR THIS
 * MODEL — not just "weak models in general," the static rule's assumption —
 * recommend raising the line threshold so more of its edits go through
 * full-rewrite instead. Only ever raises the threshold (safer format used
 * more often); never lowers it, since a false "hashline works great, use it
 * for bigger files" signal from noisy data is the failure mode that would
 * actually hurt reliability.
 */
export function recommendFullRewriteThreshold(records: SampleTelemetry[], staticDefault: number): number | null {
    const stats: Record<ChangeFormat, Stat> = {
        hashline: { attempts: 0, passes: 0 },
        "full-rewrite": { attempts: 0, passes: 0 },
    }
    for (const r of records) {
        for (let i = 0; i < r.formats.length; i++) {
            const format = r.formats[i]!
            stats[format].attempts++
            if (r.verificationPassed[i]) stats[format].passes++
        }
    }

    const hashline = stats.hashline
    const fullRewrite = stats["full-rewrite"]
    if (hashline.attempts < MIN_OBSERVATIONS_PER_VALUE || fullRewrite.attempts < MIN_OBSERVATIONS_PER_VALUE) {
        return null
    }

    const gap = passRate(fullRewrite) - passRate(hashline)
    if (gap >= 0.2) return staticDefault * 2
    return null
}
