import { $ } from "bun"
import { existsSync } from "fs"
import type { StageResult, VerificationError } from "./types.ts"

export async function check(files: string[], _projectRoot: string): Promise<StageResult> {
    const start = Date.now()
    const tsFiles = files.filter(f => /\.tsx?$/.test(f)).filter(existsSync)
    const pyFiles = files.filter(f => f.endsWith(".py")).filter(existsSync)

    const errors: VerificationError[] = []

    if (tsFiles.length > 0) {
        // bun build strips types and fails only on real syntax errors — fastest syntax gate
        const r = await $`bun build --target bun --outdir /tmp/mdc-syntax ${tsFiles}`.quiet().nothrow()
        if (r.exitCode !== 0) {
            errors.push(...parseBunBuildErrors(r.stderr.toString()))
        }
    }

    if (pyFiles.length > 0) {
        for (const f of pyFiles) {
            const r = await $`python3 -m py_compile ${f}`.quiet().nothrow()
            if (r.exitCode !== 0) {
                errors.push({ file: f, line: 0, message: r.stderr.toString().trim(), severity: "error" })
            }
        }
    }

    return { passed: errors.length === 0, errors, durationMs: Date.now() - start }
}

function parseBunBuildErrors(stderr: string): VerificationError[] {
    const errors: VerificationError[] = []
    for (const line of stderr.split("\n")) {
        // bun build format: error: message\n  file:line:col
        const loc = line.match(/^\s{2,}(.+?):(\d+):(\d+)$/)
        if (loc) {
            errors.push({
                file: loc[1]!,
                line: parseInt(loc[2]!),
                column: parseInt(loc[3]!),
                message: "Syntax error",
                severity: "error",
            })
            continue
        }
        // generic fallback
        const generic = line.match(/(.+):(\d+):(\d+):\s*(.+)/)
        if (generic) {
            errors.push({
                file: generic[1]!,
                line: parseInt(generic[2]!),
                column: parseInt(generic[3]!),
                message: generic[4]!,
                severity: "error",
            })
        }
    }
    return errors
}
