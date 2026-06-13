import { test, expect, beforeAll, afterAll } from "bun:test"
import { writeFile, unlink, mkdir } from "fs/promises"
import { join } from "path"
import * as Pipeline from "../src/verification/pipeline.ts"
import { DEFAULT_CONFIG } from "../src/verification/config.ts"

const TMP = "/tmp/mdc-verify-test"

beforeAll(async () => {
    await mkdir(TMP, { recursive: true })
})

afterAll(async () => {
    // cleanup handled by OS /tmp rotation
})

test("passes valid TypeScript", async () => {
    const f = join(TMP, "valid.ts")
    await writeFile(f, "export const x: number = 42\n")

    const r = await Pipeline.run([f], TMP, { ...DEFAULT_CONFIG, stages: ["syntax"] })
    expect(r.passed).toBe(true)
    expect(r.stage).toBe("complete")
})

test("fails on TypeScript syntax error", async () => {
    const f = join(TMP, "syntax-error.ts")
    await writeFile(f, "export const x = {\n")  // unclosed brace

    const r = await Pipeline.run([f], TMP, { ...DEFAULT_CONFIG, stages: ["syntax"] })
    expect(r.passed).toBe(false)
    expect(r.stage).toBe("syntax")
})

test("returns score=0 when syntax fails", async () => {
    const f = join(TMP, "broken.ts")
    await writeFile(f, "const x = (\n")  // incomplete expression

    const r = await Pipeline.run([f], TMP, { ...DEFAULT_CONFIG, stages: ["syntax"] })
    expect(r.score).toBe(0)
})

test("formatErrors returns empty string on pass", async () => {
    const f = join(TMP, "format-pass.ts")
    await writeFile(f, "export const ok = true\n")

    const r = await Pipeline.run([f], TMP, { ...DEFAULT_CONFIG, stages: ["syntax"] })
    expect(Pipeline.formatErrors(r)).toBe("")
})

test("formatErrors returns error summary on failure", async () => {
    const f = join(TMP, "format-fail.ts")
    await writeFile(f, "export const x = (\n")

    const r = await Pipeline.run([f], TMP, { ...DEFAULT_CONFIG, stages: ["syntax"] })
    const msg = Pipeline.formatErrors(r)
    expect(msg).toInclude("syntax")
})

test("skips stage when not in config", async () => {
    const f = join(TMP, "skip-lint.ts")
    await writeFile(f, "export const x: number = 42\n")

    const r = await Pipeline.run([f], TMP, { ...DEFAULT_CONFIG, stages: ["syntax"] })
    expect(r.stages.lint).toBeUndefined()
    expect(r.stages.tests).toBeUndefined()
})

test("handles empty file list", async () => {
    const r = await Pipeline.run([], TMP, { ...DEFAULT_CONFIG, stages: ["syntax"] })
    expect(r.passed).toBe(true)
    expect(r.stage).toBe("complete")
})

test("Python syntax check passes valid file", async () => {
    const f = join(TMP, "valid.py")
    await writeFile(f, "def reverse(s: str) -> str:\n    return s[::-1]\n")

    const r = await Pipeline.run([f], TMP, { ...DEFAULT_CONFIG, stages: ["syntax"] })
    expect(r.passed).toBe(true)
})

test("Python syntax check fails on invalid file", async () => {
    const f = join(TMP, "invalid.py")
    await writeFile(f, "def broken(\n")  // unclosed paren

    const r = await Pipeline.run([f], TMP, { ...DEFAULT_CONFIG, stages: ["syntax"] })
    expect(r.passed).toBe(false)
    expect(r.stage).toBe("syntax")
})

test("checkContent validates in-memory TypeScript", async () => {
    const { checkContent, syntaxGateForFile } = await import("../src/verification/syntax.ts")
    const f = join(TMP, "mem.ts")

    const ok = await checkContent(f, "export const ok = 1\n")
    expect(ok.passed).toBe(true)

    const bad = await checkContent(f, "export const x = {\n")
    expect(bad.passed).toBe(false)

    const gate = syntaxGateForFile(f)
    expect((await gate("export const y = 2\n")).ok).toBe(true)
    const blocked = await gate("export const z = {\n")
    expect(blocked.ok).toBe(false)
    expect(blocked.message).toContain("Syntax check failed")
})
