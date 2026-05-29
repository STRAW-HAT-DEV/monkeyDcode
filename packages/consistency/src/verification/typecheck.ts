import { existsSync } from "node:fs"
import { join } from "node:path"
import { confine, withDashGuard } from "@monkeydcode/core/util/fs-guard"
import { $ } from "bun"
import type { StageResult, VerificationError } from "./types.ts"

export async function check(files: string[], projectRoot: string): Promise<StageResult> {
    const start = Date.now()
    const errors: VerificationError[] = []

    // Confine inputs under the trusted project root before touching them.
    const confined = files.map((f) => confine(projectRoot, f))
    const hasTsFiles = confined.some((f) => /\.tsx?$/.test(f))
    const pyFiles = confined.filter((f) => f.endsWith(".py"))

    if (hasTsFiles) {
        const pkgJson = join(projectRoot, "package.json")

        // Prefer the project's own typecheck script; fall back to bunx tsc.
        // NOTE: `bun run --cwd ${projectRoot} typecheck` intentionally runs the
        // *target project's* script — this is a trusted-root operation, so the
        // project root must never be attacker-controlled.
        const r = existsSync(pkgJson)
            ? await $`bun run --cwd ${projectRoot} typecheck`.quiet().nothrow()
            : await $`bunx tsc --noEmit --pretty false`.cwd(projectRoot).quiet().nothrow()

        if (r.exitCode !== 0) {
            errors.push(...parseTscErrors(r.stdout.toString() + r.stderr.toString()))
        }
    }

    if (pyFiles.length > 0) {
        // `--` stops flag parsing so a path can't be injected as a mypy option.
        const r = await $`python3 -m mypy --no-error-summary ${withDashGuard(pyFiles)}`.quiet().nothrow()
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
                line: Number.parseInt(m[2]!),
                column: Number.parseInt(m[3]!),
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
                line: Number.parseInt(m[2]!),
                message: m[4]!,
                severity: m[3] as "error" | "warning",
            })
        }
    }
    return errors
}
