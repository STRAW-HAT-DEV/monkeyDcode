# Step 5: Build the Verification Pipeline

**Goal:** A deterministic, model-independent quality gate.

**Why this comes before the consistency engine:** The consistency engine *uses* this to grade candidates.

**Prerequisites:** [Step 4](04-echo-milestone.md) complete.

**Reference spec:** [verification.md](verification.md)

---

## 5.1 Pipeline orchestrator

`packages/consistency/src/verification/pipeline.ts`:
```typescript
import { Effect } from "effect"
import * as Syntax from "./syntax.ts"
import * as TypeCheck from "./typecheck.ts"
import * as Lint from "./lint.ts"
import * as ExistingTests from "./test-existing.ts"

export interface VerificationResult {
    passed: boolean
    stage: "syntax" | "typecheck" | "lint" | "tests" | "smoke" | "complete"
    score: number
    errors: VerificationError[]
}

export interface VerificationError {
    file: string
    line: number
    column?: number
    message: string
    severity: "error" | "warning"
    rule?: string
}

const STAGE_WEIGHTS = {
    syntax: 0.10,
    typecheck: 0.25,
    lint: 0.10,
    tests: 0.30,
    smoke: 0.10,
} as const

export function run(files: string[]): Effect.Effect<VerificationResult> {
    return Effect.gen(function* () {
        let score = 0

        const syntax = yield* Syntax.check(files)
        if (!syntax.passed) return fail("syntax", syntax.errors, score)
        score += STAGE_WEIGHTS.syntax

        const types = yield* TypeCheck.check(files)
        if (!types.passed) return fail("typecheck", types.errors, score)
        score += STAGE_WEIGHTS.typecheck

        const lint = yield* Lint.check(files)
        if (!lint.passed) return fail("lint", lint.errors, score)
        score += STAGE_WEIGHTS.lint

        const tests = yield* ExistingTests.run()
        if (!tests.passed) return fail("tests", tests.errors, score)
        score += STAGE_WEIGHTS.tests

        return { passed: true, stage: "complete", score: 1.0, errors: [] }
    })
}

function fail(stage, errors, score) {
    return { passed: false, stage, score, errors }
}
```

## 5.2 Each checker

### Syntax (`syntax.ts`)

```typescript
import { Effect } from "effect"
import { $ } from "bun"

export function check(files: string[]) {
    return Effect.gen(function* () {
        const tsFiles = files.filter(f => /\.tsx?$/.test(f))
        if (tsFiles.length === 0) return { passed: true, errors: [] }

        const result = yield* Effect.tryPromise(() =>
            $`bunx tsc --noEmit --pretty false ${tsFiles}`.quiet().nothrow()
        )

        if (result.exitCode === 0) return { passed: true, errors: [] }
        return { passed: false, errors: parseTscErrors(result.stderr.toString()) }
    })
}

function parseTscErrors(stderr: string) {
    return stderr.split("\n")
        .filter(l => l.includes(": error"))
        .map(line => {
            const m = line.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/)
            if (!m) return null
            return {
                file: m[1]!, line: +m[2]!, column: +m[3]!,
                message: m[5]!, severity: "error" as const, rule: m[4]
            }
        })
        .filter((e): e is NonNullable<typeof e> => e !== null)
}
```

### Typecheck (`typecheck.ts`)

Similar to syntax but per-language:
- `.ts/.tsx` -> `tsc --noEmit`
- `.py` -> `uv run mypy`
- `.rs` -> `rustc --check`
- `.go` -> `go vet`

### Lint (`lint.ts`)

```typescript
export function check(files: string[]) {
    return Effect.gen(function* () {
        const tsFiles = files.filter(f => /\.(t|j)sx?$/.test(f))
        const pyFiles = files.filter(f => f.endsWith(".py"))

        if (tsFiles.length > 0) {
            // bunx biome check --error-on-warnings
        }
        if (pyFiles.length > 0) {
            // uv run ruff check
        }
    })
}
```

### Existing tests (`test-existing.ts`)

```typescript
export function run() {
    return Effect.gen(function* () {
        // Detect project type from package.json / pyproject.toml
        // Run bun test / pytest / cargo test
        const r = yield* Effect.tryPromise(() => $`bun test`.quiet().nothrow())
        if (r.exitCode === 0) return { passed: true, errors: [] }
        return { passed: false, errors: parseTestFailures(r.stdout.toString()) }
    })
}
```

## 5.3 Expose as a tool

`packages/engine/src/tool/verify.ts`:
```typescript
import { Tool } from "../tool/index.ts"
import { Schema } from "@effect/schema"
import * as Pipeline from "@monkeydcode/consistency/verification/pipeline"

export const verify = Tool.make({
    name: "verify",
    description: "Run the verification pipeline on the given files",
    parameters: Schema.Struct({ files: Schema.Array(Schema.String) }),
    execute: ({ files }) => Pipeline.run(files)
})
```

Register it in the tool registry.

## 5.4 Test

`packages/consistency/test/verification.test.ts`:
```typescript
import { test, expect } from "bun:test"
import { Effect } from "effect"
import * as Pipeline from "../src/verification/pipeline.ts"
import { writeFile } from "fs/promises"

test("passes valid code", async () => {
    await writeFile("/tmp/valid.ts", "export const x: number = 42")
    const r = await Effect.runPromise(Pipeline.run(["/tmp/valid.ts"]))
    expect(r.passed).toBe(true)
})

test("fails on type error", async () => {
    await writeFile("/tmp/invalid.ts", "export const x: number = 'oops'")
    const r = await Effect.runPromise(Pipeline.run(["/tmp/invalid.ts"]))
    expect(r.passed).toBe(false)
    expect(r.stage).toBe("typecheck")
})
```

## 5.5 Per-project config

`packages/consistency/src/verification/config.ts`:
```typescript
import { z } from "zod"

export const VerificationConfig = z.object({
    stages: z.array(z.enum(["syntax", "typecheck", "lint", "tests", "smoke"]))
        .default(["syntax", "typecheck", "lint", "tests"]),
    testTimeout: z.number().default(120),
    smokeCommand: z.string().optional(),
})
```

Load from `.monkeydcode.toml`.

## 5.6 Commit

```bash
git add -A
git commit -m "feat: verification pipeline

Sequential stages: syntax -> typecheck -> lint -> tests
Returns structured errors for feedback loops."
```

## Validation Checklist

- [ ] Pipeline runs on TypeScript files
- [ ] Pipeline runs on Python files
- [ ] Returns `passed: true` for valid code
- [ ] Returns structured errors for invalid code
- [ ] Errors include file, line, message
- [ ] Stops at first failing stage (early exit)
- [ ] Available as a callable tool

## Next Step

[Step 6: Consistency engine](06-consistency-engine.md)
