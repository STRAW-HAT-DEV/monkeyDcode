import { $ } from "bun"
import { existsSync } from "fs"
import { unlink, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { extname, join } from "path"
import type { StageResult, VerificationError } from "./types.ts"

import { runWithTimeout } from "./utils.ts"

const SYNTAX_EXTENSIONS = /\.tsx?$|\.py$/

export async function check(files: string[], _projectRoot: string, timeoutMs = 5_000): Promise<StageResult> {
    return runWithTimeout(
        () => checkInner(files),
        timeoutMs,
        () => ({
            passed: false,
            errors: [{ file: "", line: 0, message: `Syntax check timed out after ${timeoutMs}ms`, severity: "error" }],
            durationMs: timeoutMs,
        }),
    )
}

/** Syntax-check in-memory content by writing a temp file (used by hashline verifyBeforeWrite). */
export async function checkContent(
    filePath: string,
    content: string,
    timeoutMs = 5_000,
): Promise<StageResult> {
    const ext = extname(filePath).toLowerCase()
    if (!SYNTAX_EXTENSIONS.test(ext)) {
        return { passed: true, errors: [], durationMs: 0 }
    }

    const tempPath = join(tmpdir(), `mdc-syntax-${crypto.randomUUID()}${ext}`)
    try {
        await writeFile(tempPath, content, "utf-8")
        const result = await check([tempPath], "", timeoutMs)
        return {
            ...result,
            errors: result.errors.map(e => ({ ...e, file: filePath })),
        }
    } finally {
        await unlink(tempPath).catch(() => {})
    }
}

export function formatStageErrors(result: StageResult, label = "Syntax check"): string {
    if (result.passed) return ""
    const lines = result.errors.map(e =>
        e.line > 0 ? `${e.file}:${e.line} ${e.message}` : `${e.file || label}: ${e.message}`,
    )
    return lines.join("\n") || `${label} failed`
}

/** verifyBeforeWrite hook for hashline — rejects patch before disk write on syntax error. */
export function syntaxGateForFile(filePath: string, timeoutMs = 5_000) {
    return async (nextContent: string): Promise<{ ok: boolean; message?: string }> => {
        const result = await checkContent(filePath, nextContent, timeoutMs)
        if (result.passed) return { ok: true }
        return {
            ok: false,
            message: `Syntax check failed — patch not written:\n${formatStageErrors(result)}`,
        }
    }
}

async function checkInner(files: string[]): Promise<StageResult> {
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
            const py = process.platform === "win32" ? "python" : "python3"
            const r = await $`${py} -m py_compile ${f}`.quiet().nothrow()
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
