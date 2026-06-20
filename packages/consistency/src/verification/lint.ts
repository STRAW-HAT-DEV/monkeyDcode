import { $ } from "bun"
import { existsSync } from "fs"
import { join } from "path"
import type { StageResult, VerificationError } from "./types.ts"

import { runWithTimeout } from "./utils.ts"

export async function check(files: string[], projectRoot: string, timeoutMs = 15_000): Promise<StageResult> {
    return runWithTimeout(
        () => checkInner(files, projectRoot),
        timeoutMs,
        () => ({
            passed: false,
            errors: [{ file: projectRoot, line: 0, message: `Lint timed out after ${timeoutMs}ms`, severity: "error" }],
            durationMs: timeoutMs,
        }),
    )
}

async function checkInner(files: string[], projectRoot: string): Promise<StageResult> {
    const start = Date.now()
    const errors: VerificationError[] = []

    const tsFiles = files.filter(f => /\.(t|j)sx?$/.test(f))
    const pyFiles = files.filter(f => f.endsWith(".py"))

    // TypeScript/JavaScript — prefer Biome, fall back to ESLint
    if (tsFiles.length > 0) {
        const hasBiome = existsSync(join(projectRoot, "biome.json")) || existsSync(join(projectRoot, "biome.jsonc"))
        const hasEslint = existsSync(join(projectRoot, ".eslintrc.js")) || existsSync(join(projectRoot, ".eslintrc.json")) || existsSync(join(projectRoot, "eslint.config.js"))

        if (hasBiome) {
            const r = await $`bunx biome check --reporter json ${tsFiles}`.cwd(projectRoot).quiet().nothrow()
            if (r.exitCode !== 0) {
                errors.push(...parseBiomeErrors(r.stdout.toString()))
            }
        } else if (hasEslint) {
            const r = await $`bunx eslint --format json ${tsFiles}`.cwd(projectRoot).quiet().nothrow()
            if (r.exitCode !== 0) {
                errors.push(...parseEslintErrors(r.stdout.toString()))
            }
        }
        // no linter configured → skip silently (skipMissingTools)
    }

    // Python — ruff
    if (pyFiles.length > 0) {
        const r = await $`python3 -m ruff check --output-format json ${pyFiles}`.quiet().nothrow()
        if (r.exitCode !== 0 && !r.stderr.toString().includes("No module named ruff")) {
            errors.push(...parseRuffErrors(r.stdout.toString()))
        }
    }

    const rsFiles = files.filter(f => f.endsWith(".rs"))
    const goFiles = files.filter(f => f.endsWith(".go"))

    if (rsFiles.length > 0 && existsSync(join(projectRoot, "Cargo.toml"))) {
        const r = await $`cargo clippy --quiet -- -D warnings`.cwd(projectRoot).quiet().nothrow()
        if (r.exitCode !== 0) {
            errors.push({
                file: projectRoot,
                line: 0,
                message: r.stderr.toString().slice(0, 500) || "clippy failed",
                severity: "error",
                rule: "clippy",
            })
        }
    }

    if (goFiles.length > 0 && existsSync(join(projectRoot, "go.mod"))) {
        const r = await $`golangci-lint run ./...`.cwd(projectRoot).quiet().nothrow()
        if (r.exitCode !== 0 && !r.stderr.toString().includes("not found")) {
            errors.push({
                file: projectRoot,
                line: 0,
                message: r.stderr.toString().slice(0, 500) || "golangci-lint failed",
                severity: "error",
                rule: "golangci-lint",
            })
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
        const results = JSON.parse(json) as Array<{ filePath: string; messages: Array<{ line: number; column: number; message: string; severity: number; ruleId: string | null }> }>
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
        const results = JSON.parse(json) as Array<{ filename: string; location: { row: number; column: number }; message: string; code: string }>
        return results.map(r => ({
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
