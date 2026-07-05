/**
 * Sampler telemetry — ROADMAP.md §8.4.
 *
 * Every sampling decision (temperatures tried, repair attempts, verification
 * scores, which candidate won and why) is appended as one JSON line per
 * project per day. Without this there is no way to debug a benchmark
 * regression after the fact — "quality dropped" with no record of what the
 * sampler actually did is unfalsifiable. Best-effort: a telemetry write
 * failure must never fail the task it's describing.
 */
import { appendFile, mkdir } from "fs/promises"
import { join } from "path"

export interface SampleTelemetry {
    timestamp: string
    modelId: string
    provider: string
    capabilityLevel: number
    creative: boolean
    temperatures: number[]
    /** Repair attempts actually used per candidate, same order as temperatures. */
    repairAttempts: number[]
    verificationScores: number[]
    verificationPassed: boolean[]
    resampleRetries: number
    selectedTemperature: number | null
    selectedScore: number
    confidence: number
    passed: boolean
    durationMs: number
}

function telemetryDir(): string {
    return join(process.cwd(), ".monkeydcode", "telemetry")
}

function telemetryFile(): string {
    return join(telemetryDir(), `${new Date().toISOString().slice(0, 10)}.jsonl`)
}

export async function record(entry: SampleTelemetry): Promise<void> {
    try {
        await mkdir(telemetryDir(), { recursive: true })
        await appendFile(telemetryFile(), JSON.stringify(entry) + "\n")
    } catch (err) {
        console.warn("[telemetry] failed to record sampling decision (non-fatal):", err)
    }
}
