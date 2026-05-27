import { $ } from "bun"
import { existsSync } from "fs"
import { join } from "path"
import type { StageResult, VerificationError } from "./types.ts"

export async function check(files: string[], projectRoot: string): Promise<StageResult> {
    const start = Date.now()
    const errors: VerificationError[] = []

    const hasTsFiles = files.some(f => /\.tsx?$/.test(f))
    const hasPyFiles = files.some(f => f.endsWith(".py"))

    if (hasTsFiles) {
        const pkgJson = join(projectRoot, "package.json")
        const hasBunWorkspace = existsSync(join(projectRoot, "bun.lock")) || existsSync(join(projectRoot, "bun.lockb"))

        // Prefer the project's own typecheck script; fall back to bunx tsc
        let r
        if (existsSync(pkgJson)) {
            r = await $`bun run --cwd ${projectRoot} typecheck`.quiet().nothrow()
        } else {
            r = await $`bunx tsc --noEmit --pretty false`.cwd(projectRoot).quiet().nothrow()
        }

        if (r.exitCode !== 0) {
            errors.push(...parseTscErrors(r.stdout.toString() + r.stderr.toString()))
        }
    }

    if (hasPyFiles) {
        // Use mypy if available, otherwise uv run mypy
        const r = await $`python3 -m mypy --no-error-summary ${files.filter(f => f.endsWith(".py"))}`.quiet().nothrow()
        if (r.exitCode !== 0 && !r.stderr.toString().includes("No module named mypy")) {
            errors.push(...parseMypyErrors(r.stdout.toString()))
        }
    }

    return { passed: errors.length === 0, errors, durationMs: Date.now() - start }
}

function parseTscErrors(output: string): VerificationError[] {
    const errors: VerificationError[] = []
    for (const line of output.split("\n")) {
        const m = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s*(TS\d+):\s*(.+)$/)
        if (m) {
            errors.push({
                file: m[1]!,
                line: parseInt(m[2]!),
                column: parseInt(m[3]!),
                message: m[5]!,
                severity: "error",
                rule: m[4],
            })
        }
    }
    return errors
}

function parseMypyErrors(output: string): VerificationError[] {
    const errors: VerificationError[] = []
    for (const line of output.split("\n")) {
        const m = line.match(/^(.+?):(\d+):\s*(error|warning):\s*(.+)$/)
        if (m) {
            errors.push({
                file: m[1]!,
                line: parseInt(m[2]!),
                message: m[4]!,
                severity: m[3] as "error" | "warning",
            })
        }
    }
    return errors
}
