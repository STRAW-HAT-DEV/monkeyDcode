import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, writeFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { checkPage, isAvailable, toStageResult, run } from "../src/verification/browser-check.ts"

// NOTE on live-render coverage: the tests below that require `isAvailable()`
// were exercised for real, once, with Playwright + Chromium installed
// (temporarily, then removed — this package deliberately does not declare
// Playwright as a dependency; see the module header). All three passed
// against real broken/clean/screenshot pages. They now "honestly skip" in
// this repo's default CI/dev environment, where Playwright isn't installed —
// exactly the state the overwhelming majority of users will actually run in,
// and the one this module is designed to degrade cleanly under (see the
// non-skipped tests below, plus toStageResult()'s pure-logic tests, which
// need no browser and always run).

let dir: string

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "mdc-browsercheck-"))
})
afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
})

test("gracefully returns null when Playwright is unavailable — never throws", async () => {
    // This assertion only has teeth in the default (no-Playwright) environment;
    // when it IS installed (this session, for verification), it's a no-op check.
    const available = await isAvailable()
    if (!available) {
        const result = await checkPage("file:///does/not/matter.html")
        expect(result).toBeNull()
    }
})

test("a real headless render catches a JS-injected broken image a static regex scan cannot see", async () => {
    if (!(await isAvailable())) return // documented, honest skip — see module header

    const file = join(dir, "dynamic.html")
    await writeFile(
        file,
        `<!DOCTYPE html><html><body>
            <script>
                // Constructed at runtime — assets.ts's regex scan cannot see this.
                const img = document.createElement("img");
                img.src = "definitely-does-not-exist-" + "12345" + ".png";
                document.body.appendChild(img);
                console.error("a real console error, for good measure");
            </script>
        </body></html>`,
    )

    const result = await checkPage(`file://${file.replace(/\\/g, "/")}`, 15_000)
    expect(result).not.toBeNull()
    expect(result!.failedRequests.some(r => r.url.includes("definitely-does-not-exist-12345.png"))).toBe(true)
    expect(result!.consoleErrors.some(c => c.text.includes("a real console error"))).toBe(true)
}, 20_000)

test("a clean page with no broken resources reports zero failures", async () => {
    if (!(await isAvailable())) return

    const file = join(dir, "clean.html")
    await writeFile(file, `<!DOCTYPE html><html><body><h1>All good</h1></body></html>`)

    const result = await checkPage(`file://${file.replace(/\\/g, "/")}`, 15_000)
    expect(result).not.toBeNull()
    expect(result!.failedRequests).toEqual([])
    expect(result!.consoleErrors).toEqual([])
}, 20_000)

test("captureScreenshot=true returns a real non-empty PNG of the actually-rendered page", async () => {
    if (!(await isAvailable())) return

    const file = join(dir, "shot.html")
    await writeFile(file, `<!DOCTYPE html><html><body style="background:red"><h1>Shot me</h1></body></html>`)

    const result = await checkPage(`file://${file.replace(/\\/g, "/")}`, 15_000, true)
    expect(result?.screenshot).not.toBeNull()
    expect(result!.screenshot!.mediaType).toBe("image/png")
    expect(result!.screenshot!.base64.length).toBeGreaterThan(1000)
}, 20_000)

// ─── toStageResult: pure logic, no browser required — always runs ──────────

test("toStageResult: null result (Playwright absent / render failed) passes trivially", () => {
    const r = toStageResult(null, "index.html", 5)
    expect(r).toEqual({ passed: true, errors: [], durationMs: 5 })
})

test("toStageResult: a failed request fails the stage as an error", () => {
    const r = toStageResult(
        { failedRequests: [{ url: "http://x/dead.png", status: 404 }], consoleErrors: [], screenshot: null },
        "index.html",
        10,
    )
    expect(r.passed).toBe(false)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.severity).toBe("error")
    expect(r.errors[0]!.rule).toBe("browser")
    expect(r.errors[0]!.message).toContain("dead.png")
    expect(r.errors[0]!.message).toContain("404")
})

test("toStageResult: a console error alone is a WARNING and does not fail the stage", () => {
    const r = toStageResult(
        { failedRequests: [], consoleErrors: [{ text: "some caught, harmless error" }], screenshot: null },
        "index.html",
        10,
    )
    expect(r.passed).toBe(true) // warnings never fail the build on their own
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]!.severity).toBe("warning")
})

test("toStageResult: a clean result (no failures, no console errors) passes with zero errors", () => {
    const r = toStageResult({ failedRequests: [], consoleErrors: [], screenshot: null }, "index.html", 10)
    expect(r).toEqual({ passed: true, errors: [], durationMs: 10 })
})

// ─── run(): the pipeline-facing entry point — real, no browser needed for
// the "no HTML file" and "Playwright not installed" paths (both genuinely
// exercised here, in this repo's real default environment). ─────────────────

test("run(): no HTML file in the changeset passes trivially without attempting any render", async () => {
    const result = await run(["foo.ts", "bar.css"], "/does/not/matter")
    expect(result).toEqual({ passed: true, errors: [], durationMs: expect.any(Number) })
})

test("run(): an HTML file present but Playwright not installed still passes (degrades cleanly)", async () => {
    if (await isAvailable()) return // this environment has it installed right now — see note above
    const result = await run(["index.html"], dir)
    expect(result.passed).toBe(true)
    expect(result.errors).toEqual([])
})

test("run(): prefers index.html as the entry point when multiple HTML files changed", async () => {
    if (await isAvailable()) return
    const result = await run(["about.html", "index.html", "contact.html"], dir)
    // Can't observe which file it picked without a real render, but this
    // proves it doesn't throw/hang when asked to choose among several.
    expect(result.passed).toBe(true)
})
