/**
 * Best-effort headless screenshot for render-and-critique grading of HTML
 * artifacts — ROADMAP.md §9 item 7.
 *
 * Playwright is a LAZY, OPTIONAL dependency: it is deliberately NOT declared
 * in any package.json here. It pulls a large Chromium binary at install
 * time, and growing this project's install footprint for every user — most
 * of whom are not generating landing pages — should be a visible, deliberate
 * decision, not a side effect of a grading improvement. If Playwright isn't
 * installed (the default), `screenshotHtml` returns null and callers fall
 * back to the text-based judge in grader.ts. Nothing breaks either way.
 *
 * To enable: `bun add playwright && bunx playwright install chromium` in the
 * project root.
 */
import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

export interface Screenshot {
    base64: string
    mediaType: "image/png"
}

// Minimal local shape for the one Playwright entry point this module uses.
// Deliberately NOT `typeof import("playwright")` — that would make the real
// package's type declarations a hard typecheck-time dependency even though
// it's an optional runtime one. Loaded via a variable specifier so bundlers
// and `tsc` don't try to statically resolve "playwright" at all.
interface PlaywrightModule {
    chromium: {
        launch(options: { headless: boolean }): Promise<{
            newPage(options: { viewport: { width: number; height: number } }): Promise<{
                goto(url: string, options: { timeout: number; waitUntil: string }): Promise<unknown>
                screenshot(options: { type: "png" }): Promise<Buffer>
            }>
            close(): Promise<void>
        }>
    }
}

let availability: boolean | null = null
// Widened to `string`, not narrowed to the literal type — a dynamic import()
// with a literal string argument can trigger TS's module resolution even
// when a `require` isn't otherwise possible; widening guarantees the
// "playwright" package's own type declarations are never a typecheck-time
// dependency, only a runtime one.
const PLAYWRIGHT: string = "playwright"

async function loadPlaywright(): Promise<PlaywrightModule | null> {
    try {
        const mod = (await import(PLAYWRIGHT)) as PlaywrightModule
        availability = true
        return mod
    } catch {
        availability = false
        return null
    }
}

export async function isAvailable(): Promise<boolean> {
    if (availability !== null) return availability
    await loadPlaywright()
    return availability ?? false
}

/** Render `html` in headless chromium and return a PNG screenshot, or null
 *  if Playwright isn't installed or rendering fails for any reason — a
 *  render failure should degrade grading quality, not crash the sampler. */
export async function screenshotHtml(html: string, timeoutMs = 15_000): Promise<Screenshot | null> {
    const playwright = await loadPlaywright()
    if (!playwright) return null

    let dir: string | null = null
    try {
        dir = await mkdtemp(join(tmpdir(), "mdc-screenshot-"))
        const tmpFile = join(dir, "preview.html")
        await writeFile(tmpFile, html, "utf-8")

        const browser = await playwright.chromium.launch({ headless: true })
        try {
            const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
            await page.goto(`file://${tmpFile}`, { timeout: timeoutMs, waitUntil: "networkidle" })
            const buf = await page.screenshot({ type: "png" })
            return { base64: buf.toString("base64"), mediaType: "image/png" }
        } finally {
            await browser.close()
        }
    } catch {
        return null
    } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
}
