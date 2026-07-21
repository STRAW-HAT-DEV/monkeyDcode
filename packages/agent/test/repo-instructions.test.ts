import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtemp, writeFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { loadRepoInstructions } from "../src/repo-instructions.ts"

let dir: string
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mdc-repoinstr-"))
})
afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
})

test("returns '' when no instruction file exists — never throws", async () => {
    expect(await loadRepoInstructions(dir)).toBe("")
})

test("reads a real AGENTS.md and labels it correctly", async () => {
    await writeFile(join(dir, "AGENTS.md"), "Always use tabs, not spaces.")
    const result = await loadRepoInstructions(dir)
    expect(result).toContain("AGENTS.md")
    expect(result).toContain("Always use tabs, not spaces.")
})

test("falls back to CLAUDE.md when AGENTS.md is absent", async () => {
    await writeFile(join(dir, "CLAUDE.md"), "This repo uses Bun workspaces.")
    const result = await loadRepoInstructions(dir)
    expect(result).toContain("CLAUDE.md")
    expect(result).toContain("Bun workspaces")
})

test("prefers AGENTS.md over CLAUDE.md when both exist", async () => {
    await writeFile(join(dir, "AGENTS.md"), "AGENTS wins")
    await writeFile(join(dir, "CLAUDE.md"), "CLAUDE loses")
    const result = await loadRepoInstructions(dir)
    expect(result).toContain("AGENTS wins")
    expect(result).not.toContain("CLAUDE loses")
})

test("an empty instruction file is treated as absent, falling through to the next candidate", async () => {
    await writeFile(join(dir, "AGENTS.md"), "   \n  ")
    await writeFile(join(dir, "CLAUDE.md"), "real content here")
    const result = await loadRepoInstructions(dir)
    expect(result).toContain("real content here")
})

test("a very large instruction file is truncated, not fed in unbounded", async () => {
    await writeFile(join(dir, "AGENTS.md"), "x".repeat(20_000))
    const result = await loadRepoInstructions(dir)
    expect(result.length).toBeLessThan(20_000)
    expect(result).toContain("truncated")
})
