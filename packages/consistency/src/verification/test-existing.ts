import { $ } from "bun"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import type { StageResult, VerificationError } from "./types.ts"

import { runWithTimeout } from "./utils.ts"

export async function run(projectRoot: string, timeoutMs: number): Promise<StageResult> {
    return runWithTimeout(
        () => runInner(projectRoot),
        timeoutMs,
        () => ({
            passed: false,
            errors: [{ file: projectRoot, line: 0, message: `Tests timed out after ${timeoutMs}ms`, severity: "error" }],
            durationMs: timeoutMs,
        }),
    )
}

async function runInner(projectRoot: string): Promise<StageResult> {
    const start = Date.now()

    const runner = detectTestRunner(projectRoot)
    if (!runner) {
        return { passed: true, errors: [], durationMs: 0 }
    }

    const r = await runner.command.quiet().nothrow()

    if (r.exitCode === 0) {
        return { passed: true, errors: [], durationMs: Date.now() - start }
    }

    const errors = runner.parse(r.stdout.toString() + r.stderr.toString())
    return { passed: false, errors, durationMs: Date.now() - start }
}

interface TestRunner {
    command: ReturnType<typeof $>
    parse: (output: string) => VerificationError[]
}

function detectTestRunner(projectRoot: string): TestRunner | null {
    const pkgPath = join(projectRoot, "package.json")

    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
            const testScript: string = pkg?.scripts?.test ?? ""

            // bun:test native runner
            if (testScript.includes("bun test") || testScript === "") {
                const bunTestExists = $`bun test --dry-run`.cwd(projectRoot).quiet().nothrow()
                return {
                    command: $`bun test`.cwd(projectRoot).quiet().nothrow() as any,
                    parse: parseBunTestOutput,
                }
            }

            // npm test / vitest / jest via the project script
            if (testScript) {
                return {
                    command: $`bun run test`.cwd(projectRoot).quiet().nothrow() as any,
                    parse: parseGenericTestOutput,
                }
            }
        } catch {}
    }

    // Python: pytest
    if (existsSync(join(projectRoot, "pyproject.toml")) || existsSync(join(projectRoot, "setup.py"))) {
        return {
            command: $`python3 -m pytest -x -q --tb=short`.cwd(projectRoot).quiet().nothrow() as any,
            parse: parsePytestOutput,
        }
    }

    // Rust: cargo test
    if (existsSync(join(projectRoot, "Cargo.toml"))) {
        return {
            command: $`cargo test --quiet`.cwd(projectRoot).quiet().nothrow() as any,
            parse: parseGenericTestOutput,
        }
    }

    // Go: go test
    if (existsSync(join(projectRoot, "go.mod"))) {
        return {
            command: $`go test ./...`.cwd(projectRoot).quiet().nothrow() as any,
            parse: parseGenericTestOutput,
        }
    }

    return null
}

function parseBunTestOutput(output: string): VerificationError[] {
    const errors: VerificationError[] = []
    for (const line of output.split("\n")) {
        // bun test failure: ✗ test name\n   at file:line
        if (line.trim().startsWith("✗") || line.trim().startsWith("fail")) {
            errors.push({ file: "", line: 0, message: line.trim(), severity: "error" })
        }
        const loc = line.match(/at\s+(.+?):(\d+):(\d+)/)
        if (loc && errors.length > 0) {
            const last = errors[errors.length - 1]!
            last.file = loc[1]!
            last.line = parseInt(loc[2]!)
            last.column = parseInt(loc[3]!)
        }
    }
    return errors
}

function parsePytestOutput(output: string): VerificationError[] {
    const errors: VerificationError[] = []
    for (const line of output.split("\n")) {
        const m = line.match(/^FAILED\s+(.+?):(\w+)/)
        if (m) {
            errors.push({ file: m[1]!, line: 0, message: `Test failed: ${m[2]}`, severity: "error" })
        }
    }
    return errors
}

function parseGenericTestOutput(output: string): VerificationError[] {
    const lines = output.split("\n").filter(l => /fail|error/i.test(l)).slice(0, 20)
    return lines.map(l => ({ file: "", line: 0, message: l.trim(), severity: "error" as const }))
}
