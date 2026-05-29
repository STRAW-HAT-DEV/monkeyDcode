import { existsSync } from "node:fs"
import { join } from "node:path"
import { confine, withDashGuard } from "@monkeydcode/core/util/fs-guard"
import { $ } from "bun"
import type { StageResult, VerificationError } from "./types.ts"

export async function check(files: string[], projectRoot: string): Promise<StageResult> {
    const start = Date.now()
    const errors: VerificationError[] = []

    // Confine inputs under the trusted project root before passing to any linter.
    const confined = files.map((f) => confine(projectRoot, f))
    const tsFiles = confined.filter((f) => /\.(t|j)sx?$/.test(f))
    const pyFiles = confined.filter((f) => f.endsWith(".py"))

    // TypeScript/JavaScript — prefer Biome, fall back to ESLint.
    // `--` stops flag parsing so a path can't be injected as a CLI option.
    if (tsFiles.length > 0) {
        const hasBiome = existsSync(join(projectRoot, "biome.json")) || existsSync(join(projectRoot, "biome.jsonc"))
        const hasEslint =
            existsSync(join(projectRoot, ".eslintrc.js")) ||
            existsSync(join(projectRoot, ".eslintrc.json")) ||
            existsSync(join(projectRoot, "eslint.config.js"))

        if (hasBiome) {
            const r = await $`bunx biome check --reporter json ${withDashGuard(tsFiles)}`
                .cwd(projectRoot)
                .quiet()
                .nothrow()
            if (r.exitCode !== 0) {
                errors.push(...parseBiomeErrors(r.stdout.toString()))
            }
        } else if (hasEslint) {
            const r = await $`bunx eslint --format json ${withDashGuard(tsFiles)}`.cwd(projectRoot).quiet().nothrow()
            if (r.exitCode !== 0) {
                errors.push(...parseEslintErrors(r.stdout.toString()))
            }
        }
        // no linter configured → skip silently (skipMissingTools)
    }

    // Python — ruff
    if (pyFiles.length > 0) {
        const r = await $`python3 -m ruff check --output-format json ${withDashGuard(pyFiles)}`.quiet().nothrow()
        if (r.exitCode !== 0 && !r.stderr.toString().includes("No module named ruff")) {
            errors.push(...parseRuffErrors(r.stdout.toString()))
        }
    }

    return { passed: errors.length === 0, errors, durationMs: Date.now() - start }
}

function parseBiomeErrors(json: string): VerificationError[] {
    try {
        const data = JSON.parse(json)
        const errors: VerificationError[] = []
        for (const diag of data?.diagnostics ?? []) {
            const loc = diag.location
            errors.push({
                file: loc?.path?.file ?? "",
                line: loc?.span?.start?.line ?? 0,
                column: loc?.span?.start?.character,
                message: diag.description ?? diag.message ?? "Lint error",
                severity: diag.severity === "warning" ? "warning" : "error",
                rule: diag.category,
            })
        }
        return errors
    } catch {
        return []
    }
}

function parseEslintErrors(json: string): VerificationError[] {
    try {
        const results = JSON.parse(json) as Array<{
            filePath: string
            messages: Array<{ line: number; column: number; message: string; severity: number; ruleId: string | null }>
        }>
        const errors: VerificationError[] = []
        for (const file of results) {
            for (const msg of file.messages) {
                errors.push({
                    file: file.filePath,
                    line: msg.line,
                    column: msg.column,
                    message: msg.message,
                    severity: msg.severity === 1 ? "warning" : "error",
                    rule: msg.ruleId ?? undefined,
                })
            }
        }
        return errors
    } catch {
        return []
    }
}

function parseRuffErrors(json: string): VerificationError[] {
    try {
        const results = JSON.parse(json) as Array<{
            filename: string
            location: { row: number; column: number }
            message: string
            code: string
        }>
        return results.map((r) => ({
            file: r.filename,
            line: r.location.row,
            column: r.location.column,
            message: r.message,
            severity: "error" as const,
            rule: r.code,
        }))
    } catch {
        return []
    }
}
