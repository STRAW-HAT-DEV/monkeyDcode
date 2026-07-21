import type { Stage } from "./types.ts"

export interface VerificationConfig {
    stages: Stage[]
    testTimeout: number
    smokeCommand?: string
    skipMissingTools: boolean
    /** Per-stage timeouts in ms — plan/verification.md */
    stageTimeouts: Record<string, number>
}

export const DEFAULT_CONFIG: VerificationConfig = {
    // "browser" is safe to default ON even though Playwright is an optional,
    // usually-absent dependency: toStageResult() passes trivially whenever
    // checkPage() returns null (not installed), so including it costs
    // nothing for the common case and adds real coverage the moment a user
    // opts into Playwright — same reasoning as "assets".
    stages: ["syntax", "typecheck", "lint", "tests", "assets", "browser"],
    testTimeout: 120_000,
    skipMissingTools: true,
    stageTimeouts: {
        syntax: 5_000,
        typecheck: 30_000,
        lint: 15_000,
        tests: 120_000,
        "test-generated": 60_000,
        assets: 20_000,
        browser: 20_000,
        smoke: 30_000,
    },
}
