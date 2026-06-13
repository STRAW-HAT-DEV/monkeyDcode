import { $ } from "bun"
import { mkdir, writeFile, rm } from "fs/promises"
import { join, relative, dirname } from "path"
import type { StageResult, VerificationError } from "./types.ts"
import { runWithTimeout } from "./utils.ts"

const GEN_DIR = ".monkeydcode/generated-tests"

export async function run(
    files: string[],
    projectRoot: string,
    timeoutMs: number,
): Promise<StageResult> {
    const start = Date.now()
    const tsFiles = files.filter(f => /\.tsx?$/.test(f))
    if (tsFiles.length === 0) {
        return { passed: true, errors: [], durationMs: 0 }
    }

    const genRoot = join(projectRoot, GEN_DIR)
    await mkdir(genRoot, { recursive: true })

    const testPath = join(genRoot, "smoke.test.ts")
    const imports = tsFiles.map((f, i) => {
        const rel = relative(dirname(testPath), f).replace(/\\/g, "/").replace(/\.tsx?$/, "")
        return `import * as m${i} from "${rel.startsWith(".") ? rel : "./" + rel}"`
    })
    const assertions = tsFiles.map((_, i) =>
        `expect(typeof m${i}).toBe("object")`,
    )

    await writeFile(testPath, `import { test, expect } from "bun:test"
${imports.join("\n")}

test("generated smoke imports", () => {
  ${assertions.join("\n  ")}
})
`)

    const result = await runWithTimeout(
        async () => {
            const r = await $`bun test ${testPath}`.cwd(projectRoot).quiet().nothrow()
            if (r.exitCode === 0) {
                return { passed: true as const, errors: [] as VerificationError[] }
            }
            return {
                passed: false as const,
                errors: [{
                    file: testPath,
                    line: 0,
                    message: r.stderr.toString().slice(0, 500) || "Generated test failed",
                    severity: "error" as const,
                }],
            }
        },
        timeoutMs,
        () => ({
            passed: false as const,
            errors: [{
                file: testPath,
                line: 0,
                message: `Generated test timed out after ${timeoutMs}ms`,
                severity: "error" as const,
            }],
        }),
    )

    await rm(genRoot, { recursive: true, force: true }).catch(() => undefined)

    return { ...result, durationMs: Date.now() - start }
}
