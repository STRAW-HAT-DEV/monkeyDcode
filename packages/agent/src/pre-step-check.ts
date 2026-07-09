/**
 * Test-first step execution — ROADMAP.md Phase 2, P2-3.
 *
 * Turns a step's `verificationCriteria` (currently prose the model can
 * ignore) into a real, executable check written BEFORE the implementation is
 * sampled. Because the check is a genuine file in the project, the sampler's
 * existing verification pipeline picks it up automatically via its normal
 * "tests" stage — no changes to the pipeline, the sampler, or the repair loop
 * are needed. This module's only job is: generate the check, and validate it
 * is actually red (fails) before the implementation exists.
 *
 * Single responsibility: produce a validated, currently-failing check file.
 * Deciding WHEN to call this (which steps qualify) and what to do if the
 * step ultimately fails (roll the check back) belongs to the caller
 * (build-agent.ts) — this module doesn't know about sampling, repair, or
 * plans at all.
 */
import { Effect } from "effect"
import { rm, writeFile } from "fs/promises"
import { join } from "path"
import { ensureParentDir } from "@monkeydcode/core/util/path"
import { $ } from "bun"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { detectLanguageProfile } from "@monkeydcode/consistency/verification/test-existing"
import { detectProjectRoot } from "@monkeydcode/consistency/sampler"

export interface GeneratedCheck {
    path: string
}

const CHECK_TIMEOUT_MS = 30_000

/**
 * Generate a check for `description`/`verificationCriteria`, write it to
 * disk, and confirm it is currently red (fails without the implementation).
 * Returns null — logging why, never throwing — if generation, parsing, or
 * red-validation fails for any reason; a broken or accidentally-green check
 * must never become a silent extra hurdle the implementation has to clear.
 */
export function createPreStepCheck(
    description: string,
    verificationCriteria: string,
    targetFiles: string[],
    model: ModelRef,
): Effect.Effect<GeneratedCheck | null, unknown> {
    return Effect.gen(function* () {
        const projectRoot = detectProjectRoot(targetFiles)
        const lang = detectLanguageProfile(projectRoot)

        // Red-validation (runsAndFails) executes the check with `bun test`, which
        // only runs JS/TS. For Python/Rust/Go a `bun test` on the generated file
        // would error spuriously and be mis-read as "red," keeping an unvalidated
        // check. Rather than half-support them, skip pre-step checks entirely for
        // non-bun-testable languages — a safe degradation to the pre-P2-3
        // behavior for those projects.
        if (lang.codeFence !== "typescript") return null

        const generated = yield* Effect.promise(() => generateCheckCode(description, verificationCriteria, lang, model))
        if (!generated) return null

        const path = join(projectRoot, lang.testDir, `check-${slug(description)}.${lang.testFileSuffix}`)

        yield* Effect.promise(async () => {
            await ensureParentDir(path)
            await writeFile(path, generated, "utf-8")
        })

        const isRed = yield* Effect.promise(() => runsAndFails(path, projectRoot))
        if (!isRed) {
            // The check passed with no implementation present — it's trivial,
            // vacuous, or hallucinated as a no-op. Not useful; remove it
            // rather than leave a check that can never catch a regression.
            yield* Effect.promise(() => rm(path, { force: true }))
            return null
        }

        return { path }
    })
}

/** Remove a previously-created check — used when the step it was gating
 *  ultimately failed outright, so a permanently-failing test isn't left
 *  behind in the project (mirrors bugfix.ts's own honesty: an unresolved fix
 *  doesn't get to leave broken artifacts either). */
export function removeCheck(check: GeneratedCheck): Effect.Effect<void, unknown> {
    return Effect.promise(() => rm(check.path, { force: true }).catch(() => undefined))
}

async function generateCheckCode(
    description: string,
    verificationCriteria: string,
    lang: ReturnType<typeof detectLanguageProfile>,
    model: ModelRef,
): Promise<string | null> {
    const prompt = `Write ONE executable test that will prove this requirement is met once implemented:

## Requirement
${description}

## Verification criteria
${verificationCriteria}

${lang.frameworkHint}

The implementation does NOT exist yet — this test should currently FAIL (that
is expected and correct; it will pass once the feature is built). Test the
observable BEHAVIOR described above, not internal implementation details you
are guessing at (do not assume specific internal function/variable names
beyond what the requirement states) — an overly specific test would wrongly
block a correct implementation that structures the internals differently.

Output ONLY the test code in a single \`\`\`${lang.codeFence} fenced block. No explanation.`

    try {
        const response = await LLM.generateAsync({ model, messages: [{ role: "user", content: prompt }], temperature: 0.3 })
        const match = response.text.match(/```[\w]*\n([\s\S]*?)```/)
        const code = match?.[1]?.trim()
        return code && code.length > 0 ? code : null
    } catch {
        return null
    }
}

/** Run the single check file and report whether it currently fails (red). */
async function runsAndFails(path: string, projectRoot: string): Promise<boolean> {
    try {
        const r = await Promise.race([
            $`bun test ${path}`.cwd(projectRoot).quiet().nothrow(),
            new Promise<{ exitCode: number }>(resolve =>
                setTimeout(() => resolve({ exitCode: -1 }), CHECK_TIMEOUT_MS),
            ),
        ])
        return r.exitCode !== 0
    } catch {
        // Couldn't even run it (missing runner, syntax error in the generated
        // test itself) — treat as "not usable" rather than "usable and red."
        return false
    }
}

function slug(text: string): string {
    const s = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40)
    return s || "check"
}
