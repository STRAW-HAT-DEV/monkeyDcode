import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve } from "path"
import { detectProjectRoot } from "../src/sampler.ts"

let root: string
let origCwd: string

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mdc-projroot-"))
    await mkdir(join(root, "src", "deep"), { recursive: true })
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "x" }))
    await writeFile(join(root, "src", "math.ts"), "export const x = 1\n")
    await writeFile(join(root, "src", "deep", "y.ts"), "export const y = 2\n")
    origCwd = process.cwd()
})

afterAll(async () => {
    process.chdir(origCwd)
    await rm(root, { recursive: true, force: true })
})

test("absolute path walks up to the nearest package.json", () => {
    expect(resolve(detectProjectRoot([join(root, "src", "math.ts")]))).toBe(resolve(root))
})

test("absolute path in a deep subdir still finds the manifest root", () => {
    expect(resolve(detectProjectRoot([join(root, "src", "deep", "y.ts")]))).toBe(resolve(root))
})

test("relative path resolves against cwd, not the file's own parent segment", () => {
    // The old string-split walk returned "src" here — pointing verification and
    // generated check files at the wrong directory. It must resolve to the
    // manifest root instead.
    process.chdir(root)
    expect(resolve(detectProjectRoot(["src/math.ts"]))).toBe(resolve(root))
})

test("empty file list falls back to process.cwd()", () => {
    process.chdir(root)
    expect(resolve(detectProjectRoot([]))).toBe(resolve(root))
})

test("no manifest anywhere falls back to process.cwd(), never a partial path", async () => {
    const bare = await mkdtemp(join(tmpdir(), "mdc-bare-"))
    try {
        process.chdir(bare)
        // A relative file with no package.json in any ancestor of the resolved
        // path — must not return "" or a truncated segment.
        const result = resolve(detectProjectRoot(["loose.ts"]))
        expect(result).toBe(resolve(bare))
    } finally {
        // chdir out before removing — Windows refuses to delete the cwd.
        process.chdir(origCwd)
        await rm(bare, { recursive: true, force: true })
    }
})
