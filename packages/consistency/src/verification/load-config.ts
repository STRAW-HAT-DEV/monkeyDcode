import { loadConfig } from "@monkeydcode/core/mdc-config"
import type { VerificationConfig } from "./config.ts"
import { DEFAULT_CONFIG } from "./config.ts"
import type { Stage } from "./types.ts"

const VALID_STAGES: Stage[] = ["syntax", "typecheck", "lint", "tests", "test-generated", "smoke"]

export async function loadVerificationConfig(): Promise<VerificationConfig> {
    const mdc = await loadConfig()
    const stages = mdc.verification.stages.filter((s): s is Stage =>
        VALID_STAGES.includes(s as Stage),
    )
    return {
        stages: stages.length > 0 ? stages : DEFAULT_CONFIG.stages,
        testTimeout: mdc.verification.testTimeout * 1000,
        smokeCommand: mdc.verification.smokeCommand,
        skipMissingTools: true,
        stageTimeouts: DEFAULT_CONFIG.stageTimeouts,
    }
}
