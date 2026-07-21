import type { VerificationResult, VerificationError, Stage, StageResult } from "./types.ts"
import type { VerificationConfig } from "./config.ts"
import { DEFAULT_CONFIG } from "./config.ts"
import * as Syntax from "./syntax.ts"
import * as TypeCheck from "./typecheck.ts"
import * as Lint from "./lint.ts"
import * as Tests from "./test-existing.ts"
import * as Generated from "./test-generated.ts"
import * as Smoke from "./smoke.ts"
import * as Assets from "./assets.ts"
import * as BrowserCheck from "./browser-check.ts"
import { loadVerificationConfig } from "./load-config.ts"
import { defaultStageSelector, type StageSelector } from "./stage-selector.ts"

/** Weights per plan/verification.md */
const STAGE_WEIGHTS: Record<string, number> = {
    syntax: 0.10,
    typecheck: 0.25,
    lint: 0.10,
    tests: 0.30,
    "test-generated": 0.15,
    assets: 0.05,
    browser: 0.05,
    smoke: 0.10,
}

function timeoutFor(config: VerificationConfig, stage: string): number {
    return config.stageTimeouts[stage] ?? config.testTimeout
}

export async function run(
    files: string[],
    projectRoot: string,
    config?: VerificationConfig,
    selector: StageSelector = defaultStageSelector,
): Promise<VerificationResult> {
    const resolved = config ?? await loadVerificationConfig()
    const activeStages = selector.select(files, resolved.stages)
    const start = Date.now()
    const stages: Partial<Record<Stage, StageResult>> = {}
    let score = 0

    if (activeStages.includes("syntax")) {
        const r = await Syntax.check(files, projectRoot, timeoutFor(resolved, "syntax"))
        stages.syntax = r
        if (!r.passed) return fail("syntax", r.errors, score, stages, start)
        score += STAGE_WEIGHTS.syntax!
    }

    if (activeStages.includes("typecheck")) {
        const r = await TypeCheck.check(files, projectRoot, timeoutFor(resolved, "typecheck"))
        stages.typecheck = r
        if (!r.passed) return fail("typecheck", r.errors, score, stages, start)
        score += STAGE_WEIGHTS.typecheck!
    }

    if (activeStages.includes("lint")) {
        const r = await Lint.check(files, projectRoot, timeoutFor(resolved, "lint"))
        stages.lint = r
        if (!r.passed) return fail("lint", r.errors, score, stages, start)
        score += STAGE_WEIGHTS.lint!
    }

    if (activeStages.includes("tests")) {
        const r = await Tests.run(projectRoot, timeoutFor(resolved, "tests"))
        stages.tests = r
        if (!r.passed) return fail("tests", r.errors, score, stages, start)
        score += STAGE_WEIGHTS.tests!
    }

    if (activeStages.includes("test-generated")) {
        const r = await Generated.run(files, projectRoot, timeoutFor(resolved, "test-generated"))
        stages["test-generated"] = r
        if (!r.passed) return fail("test-generated", r.errors, score, stages, start)
        score += STAGE_WEIGHTS["test-generated"]!
    }

    if (activeStages.includes("assets")) {
        const r = await Assets.check(files, projectRoot, timeoutFor(resolved, "assets"))
        stages.assets = r
        if (!r.passed) return fail("assets", r.errors, score, stages, start)
        score += STAGE_WEIGHTS.assets!
    }

    if (activeStages.includes("browser")) {
        const r = await BrowserCheck.run(files, projectRoot, timeoutFor(resolved, "browser"))
        stages.browser = r
        if (!r.passed) return fail("browser", r.errors, score, stages, start)
        score += STAGE_WEIGHTS.browser!
    }

    if (activeStages.includes("smoke")) {
        const r = await Smoke.run(projectRoot, resolved.smokeCommand, timeoutFor(resolved, "smoke"))
        stages.smoke = r
        if (!r.passed) return fail("smoke", r.errors, score, stages, start)
        score += STAGE_WEIGHTS.smoke!
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
        const loc = err.column
            ? `${err.file}:${err.line}:${err.column}`
            : `${err.file}:${err.line}`
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

