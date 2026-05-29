import { test, expect } from "bun:test"
import { existsSync } from "fs"
import { tmpdir } from "os"
import { makeTempDir, withTempDir } from "../src/util/tmp.ts"

test("makeTempDir creates a directory under the OS temp dir", async () => {
    const dir = await makeTempDir("mdc-test-")
    expect(existsSync(dir)).toBe(true)
    expect(dir.startsWith(tmpdir())).toBe(true)
})

test("withTempDir returns the callback result and cleans up", async () => {
    let captured = ""
    const result = await withTempDir(async (dir) => {
        captured = dir
        expect(existsSync(dir)).toBe(true)
        return 42
    }, "mdc-test-")
    expect(result).toBe(42)
    expect(existsSync(captured)).toBe(false)
})

test("withTempDir cleans up even when the callback throws", async () => {
    let captured = ""
    await expect(
        withTempDir(async (dir) => {
            captured = dir
            throw new Error("boom")
        }, "mdc-test-"),
    ).rejects.toThrow("boom")
    expect(existsSync(captured)).toBe(false)
})
