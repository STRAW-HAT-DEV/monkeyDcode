import { $ } from "bun"
import type { StageResult } from "./types.ts"

import { runWithTimeout } from "./utils.ts"

export async function run(
    projectRoot: string,
    command?: string,
    timeoutMs = 30_000,
): Promise<StageResult> {
    const start = Date.now()
    if (!command) {
        return { passed: true, errors: [], durationMs: Date.now() - start }
    }

    return runWithTimeout(
        async () => {
            let result
            if (process.platform === "win32") {
                result = await $`cmd /c ${command}`.cwd(projectRoot).quiet().nothrow()
            } else {
                result = await $`sh -c ${command}`.cwd(projectRoot).quiet().nothrow()
            }

            if (result.exitCode === 0) {
                return { passed: true, errors: [], durationMs: Date.now() - start }
            }

            return {
                passed: false,
                errors: [{
                    file: projectRoot,
                    line: 0,
                    message: result.stderr.toString() || result.stdout.toString() || `Smoke command failed (exit ${result.exitCode})`,
                    severity: "error" as const,
                    rule: "smoke",
                }],
                durationMs: Date.now() - start,
            }
        },
        timeoutMs,
        () => ({
            passed: false,
            errors: [{ file: projectRoot, line: 0, message: `Smoke timed out after ${timeoutMs}ms`, severity: "error", rule: "smoke" }],
            durationMs: timeoutMs,
        }),
    )
}
