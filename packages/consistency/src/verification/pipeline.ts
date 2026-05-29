import { DEFAULT_CONFIG, type VerificationConfig } from "./config.ts"
import * as Lint from "./lint.ts"
import * as Syntax from "./syntax.ts"
import * as Tests from "./test-existing.ts"
import * as TypeCheck from "./typecheck.ts"
import type { Stage, StageResult, VerificationError, VerificationResult } from "./types.ts"

const STAGE_WEIGHTS: Record<string, number> = {
    syntax: 0.1,
    typecheck: 0.3,
    lint: 0.1,
    tests: 0.4,
    smoke: 0.1,
}

export async function run(
    files: string[],
    projectRoot: string,
    config: VerificationConfig = DEFAULT_CONFIG,
): Promise<VerificationResult> {
    const start = Date.now()
    const stages: Partial<Record<Stage, StageResult>> = {}
    let score = 0

    if (config.stages.includes("syntax")) {
        const r = await Syntax.check(files, projectRoot)
        stages.syntax = r
        if (!r.passed) return fail("syntax", r.errors, score, stages, start)
        score += STAGE_WEIGHTS.syntax!
    }

    if (config.stages.includes("typecheck")) {
        const r = await TypeCheck.check(files, projectRoot)
        stages.typecheck = r
        if (!r.passed) return fail("typecheck", r.errors, score, stages, start)
        score += STAGE_WEIGHTS.typecheck!
    }

    if (config.stages.includes("lint")) {
        const r = await Lint.check(files, projectRoot)
        stages.lint = r
        if (!r.passed) return fail("lint", r.errors, score, stages, start)
        score += STAGE_WEIGHTS.lint!
    }

    if (config.stages.includes("tests")) {
        const r = await Tests.run(projectRoot, config.testTimeout)
        stages.tests = r
        if (!r.passed) return fail("tests", r.errors, score, stages, start)
        score += STAGE_WEIGHTS.tests!
    }

    return {
        passed: true,
        stage: "complete",
        score: 1.0,
        errors: [],
        durationMs: Date.now() - start,
        stages,
    }
}

function fail(
    stage: Stage,
    errors: VerificationError[],
    score: number,
    stageMap: Partial<Record<Stage, StageResult>>,
    start: number,
): VerificationResult {
    return { passed: false, stage, score, errors, durationMs: Date.now() - start, stages: stageMap }
}

export function formatErrors(result: VerificationResult): string {
    if (result.passed) return ""

    const lines: string[] = [
        `❌ Verification failed at stage: ${result.stage} (score: ${(result.score * 100).toFixed(0)}%)`,
        "",
    ]

    for (const err of result.errors.slice(0, 30)) {
        const loc = err.column ? `${err.file}:${err.line}:${err.column}` : `${err.file}:${err.line}`
        const rule = err.rule ? ` [${err.rule}]` : ""
        lines.push(`  ${loc}${rule}: ${err.message}`)
    }

    if (result.errors.length > 30) {
        lines.push(`  ... and ${result.errors.length - 30} more errors`)
    }

    return lines.join("\n")
}

export function formatSummary(result: VerificationResult): string {
    if (result.passed) {
        return `✅ All verification stages passed (${result.durationMs}ms)`
    }
    return formatErrors(result)
}
