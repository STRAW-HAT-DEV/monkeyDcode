import { test, expect } from "bun:test"
import { readConfig, writeConfig } from "../src/fs-utils"
import { unlinkSync } from "fs"

const TEST_FILE = "/tmp/mdc-bench-config-test.txt"

test("readConfig returns a Promise", () => {
    const result = readConfig("/nonexistent/file.txt")
    expect(result).toBeInstanceOf(Promise)
})

test("readConfig rejects on missing file", async () => {
    await expect(readConfig("/nonexistent/file.txt")).rejects.toThrow()
})

test("writeConfig returns a Promise", () => {
    const result = writeConfig(TEST_FILE, "test")
    expect(result).toBeInstanceOf(Promise)
    return result
})

test("writeConfig then readConfig round-trips data", async () => {
    await writeConfig(TEST_FILE, "hello world")
    const data = await readConfig(TEST_FILE)
    expect(data).toBe("hello world")
    try { unlinkSync(TEST_FILE) } catch {}
})
