import type { Stage } from "./types.ts"

export interface VerificationConfig {
    stages: Stage[]
    testTimeout: number
    smokeCommand?: string
    skipMissingTools: boolean
}

export const DEFAULT_CONFIG: VerificationConfig = {
    stages: ["syntax", "typecheck", "lint", "tests"],
    testTimeout: 120_000,
    skipMissingTools: true,
}
