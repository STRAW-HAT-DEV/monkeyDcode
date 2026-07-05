import { test, expect } from "bun:test"
import * as Screenshot from "../src/verification/screenshot.ts"

// Playwright is a deliberately optional dependency (see screenshot.ts) — this
// suite runs the same whether or not it happens to be installed, and asserts
// the contract that matters either way: never throw, never hang.

test("isAvailable resolves without throwing", async () => {
    const available = await Screenshot.isAvailable()
    expect(typeof available).toBe("boolean")
})

test("screenshotHtml never throws and returns null or a valid screenshot", async () => {
    const result = await Screenshot.screenshotHtml("<html><body><h1>hi</h1></body></html>", 5_000)
    if (result === null) {
        expect(result).toBeNull()
    } else {
        expect(result.mediaType).toBe("image/png")
        expect(result.base64.length).toBeGreaterThan(0)
    }
})

test("screenshotHtml handles malformed HTML without throwing", async () => {
    const result = await Screenshot.screenshotHtml("<not even close to valid html", 5_000)
    expect(result === null || typeof result.base64 === "string").toBe(true)
})
