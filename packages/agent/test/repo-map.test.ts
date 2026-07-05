import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import * as RepoMap from "../src/repo-map.ts"

let root: string

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mdc-repomap-test-"))
    await mkdir(join(root, "src"), { recursive: true })
    await mkdir(join(root, "node_modules", "somepkg"), { recursive: true })
    await writeFile(join(root, "src", "index.ts"), "// entry point\nexport const x = 1\n")
    await writeFile(join(root, "src", "util.ts"), "// helpers\nexport const y = 2\n")
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "demo", description: "a demo project" }))
    // Should be pruned — never appear in the map.
    await writeFile(join(root, "node_modules", "somepkg", "index.js"), "module.exports = {}\n")
})

afterAll(async () => {
    await rm(root, { recursive: true, force: true })
})

test("includes real source files with inferred roles", async () => {
    RepoMap.invalidate(root)
    const map = await RepoMap.generate(root)
    expect(map).toContain("src/index.ts")
    expect(map).toContain("src/util.ts")
    // package.json role comes from its description.
    expect(map).toContain("a demo project")
})

test("prunes ignored directories (node_modules never appears)", async () => {
    RepoMap.invalidate(root)
    const map = await RepoMap.generate(root)
    expect(map).not.toContain("node_modules")
})

test("caches by root and invalidate forces a refresh", async () => {
    RepoMap.invalidate(root)
    const first = await RepoMap.generate(root)
    // Add a new file; without invalidation the cache should still serve the old map.
    await writeFile(join(root, "src", "added.ts"), "// added later\n")
    const cached = await RepoMap.generate(root)
    expect(cached).toBe(first)
    RepoMap.invalidate(root)
    const refreshed = await RepoMap.generate(root)
    expect(refreshed).toContain("src/added.ts")
})
