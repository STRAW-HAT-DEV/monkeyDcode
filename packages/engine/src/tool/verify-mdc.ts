/**
 * monkeyDcode verification pipeline — callable without full engine Effect context.
 * Used by agents and benchmarks.
 */
import { run as runPipeline, formatSummary, formatErrors } from "@monkeydcode/consistency/verification/pipeline"

export async function verify(files: string[], projectRoot: string) {
    return runPipeline(files, projectRoot)
}

export { formatSummary, formatErrors }

export const VerifyTool = {
    name: "verify",
    description: "Run the verification pipeline (syntax → typecheck → lint → tests → smoke) on given files",
    async execute(params: { files: string[]; projectRoot?: string }) {
        const root = params.projectRoot ?? process.cwd()
        const result = await runPipeline(params.files, root)
        return {
            passed: result.passed,
            stage: result.stage,
            score: result.score,
            errors: result.errors,
            summary: formatSummary(result),
        }
    },
}
