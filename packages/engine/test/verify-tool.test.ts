import { test, expect } from "bun:test"
import { readFile } from "fs/promises"
import { join } from "path"

test("verify tool is registered in registry source", async () => {
    const src = await readFile(join(import.meta.dir, "../src/tool/registry.ts"), "utf-8")
    expect(src).toContain("VerifyTool")
    expect(src).toContain("tool.verify")
})

test("verify tool source exists", async () => {
    const src = await readFile(join(import.meta.dir, "../src/tool/verify.ts"), "utf-8")
    expect(src).toContain('"verify"')
    expect(src).toContain("runPipeline")
})
