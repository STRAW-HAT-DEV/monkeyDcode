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
    stages: ["syntax", "typecheck", "lint", "tests"],
    testTimeout: 120_000,
    skipMissingTools: true,
    stageTimeouts: {
        syntax: 5_000,
        typecheck: 30_000,
        lint: 15_000,
        tests: 120_000,
        "test-generated": 60_000,
        smoke: 30_000,
    },
}
