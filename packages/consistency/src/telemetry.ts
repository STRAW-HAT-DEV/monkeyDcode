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
import { appendFile, mkdir, readdir, readFile } from "fs/promises"
import { join } from "path"

export type ChangeFormat = "hashline" | "full-rewrite"

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
    /** Edit format each candidate's response actually used, same order as
     *  temperatures — lets the self-tuning policy (§P2-1) correlate format
     *  choice with pass rate per model, not just per capability level. */
    formats: ChangeFormat[]
    resampleRetries: number
    selectedTemperature: number | null
    selectedScore: number
    confidence: number
    passed: boolean
    durationMs: number
}

/** Detect which edit format a candidate's response actually used. Pure/cheap —
 *  reused by both the recorder (to log what happened) and the policy module
 *  (to describe what it's recommending), so the two can never disagree on
 *  what "hashline" means. */
export function detectChangeFormat(change: string): ChangeFormat {
    return /```hashline\n/.test(change) ? "hashline" : "full-rewrite"
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

/**
 * Read every recorded sample for `modelId` across all telemetry files (there
 * is one per day; this project doesn't yet have enough volume to warrant
 * pruning by age, but a corrupt/partial line must never abort the read —
 * best-effort, same as recording). Returns [] on any directory-level failure
 * (e.g. telemetry dir doesn't exist yet) rather than throwing, since callers
 * (the self-tuning policy) must degrade to static defaults, not crash.
 */
export async function readAllForModel(modelId: string): Promise<SampleTelemetry[]> {
    let files: string[]
    try {
        files = (await readdir(telemetryDir())).filter(f => f.endsWith(".jsonl"))
    } catch {
        return []
    }

    const entries: SampleTelemetry[] = []
    for (const file of files) {
        let text: string
        try {
            text = await readFile(join(telemetryDir(), file), "utf-8")
        } catch {
            continue
        }
        for (const line of text.split("\n")) {
            if (!line.trim()) continue
            try {
                const parsed = JSON.parse(line) as SampleTelemetry
                if (parsed.modelId === modelId) entries.push(parsed)
            } catch {
                continue // one corrupt line must not lose the rest of the file
            }
        }
    }
    return entries
}
