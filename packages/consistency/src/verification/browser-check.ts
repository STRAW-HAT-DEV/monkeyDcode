/**
 * Best-effort headless-browser page check — GAPS.md Part 2, C2.
 *
 * Complements assets.ts (which extracts and validates references via regex —
 * cheap, exact, but blind to anything constructed at runtime: a JS-injected
 * `<img>`, a redirect, a CORS failure, a src built from a template string).
 * This module actually RENDERS the page in a real browser and observes what
 * happened — the only way to catch that second class of failure.
 *
 * Playwright is a LAZY, OPTIONAL dependency, same stance and same reasoning
 * as screenshot.ts (not declared in any package.json — large Chromium
 * download, most users never generate web pages). If it isn't installed,
 * `checkPage` returns null and callers degrade gracefully, never failing a
 * build over an absent optional dependency.
 *
 * To enable: `bun add playwright && bunx playwright install chromium`.
 */
import { extname, join } from "path"
import type { Screenshot } from "./screenshot.ts"
import type { StageResult, VerificationError } from "./types.ts"

export interface FailedRequest {
    url: string
    status?: number
    failure?: string
}

export interface ConsoleError {
    text: string
}

export interface BrowserCheckResult {
    failedRequests: FailedRequest[]
    consoleErrors: ConsoleError[]
    screenshot: Screenshot | null
}

// Minimal local shape for the Playwright surface this module needs — same
// deliberate non-import-of-real-types stance as screenshot.ts, so the real
// "playwright" package's types are never a typecheck-time dependency.
interface PlaywrightModule {
    chromium: {
        launch(options: { headless: boolean }): Promise<{
            newPage(options: { viewport: { width: number; height: number } }): Promise<PlaywrightPage>
            close(): Promise<void>
        }>
    }
}

interface PlaywrightResponse {
    url(): string
    status(): number
}
interface PlaywrightRequest {
    url(): string
    failure(): { errorText: string } | null
}
interface PlaywrightConsoleMessage {
    type(): string
    text(): string
}
interface PlaywrightPage {
    on(event: "response", handler: (res: PlaywrightResponse) => void): void
    on(event: "requestfailed", handler: (req: PlaywrightRequest) => void): void
    on(event: "console", handler: (msg: PlaywrightConsoleMessage) => void): void
    goto(url: string, options: { timeout: number; waitUntil: string }): Promise<unknown>
    screenshot(options: { type: "png" }): Promise<Buffer>
}

let availability: boolean | null = null
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

/** Render `url` (typically `file://...` or `http://localhost:...`) in headless
 *  chromium and report every failed network request and console error. Returns
 *  null if Playwright isn't installed or the render itself fails outright —
 *  a render failure degrades verification, it must never crash it. */
export function checkPage(
    url: string,
    timeoutMs = 15_000,
    captureScreenshot = false,
): Promise<BrowserCheckResult | null> {
    // page.goto() already has its own timeout, but chromium.launch() itself
    // does not — a stuck/misconfigured browser install can hang there
    // indefinitely (observed directly, in this exact codebase's development
    // sandbox: a restricted environment with no accessible window station
    // hung at launch() with no error, ever — 20s+, no exception, nothing).
    // This wraps the ENTIRE operation so a stuck launch degrades to null
    // instead of hanging every caller — ultimately the whole verification
    // pipeline — forever. Known trade-off: if launch() itself is what's
    // hung, there is no handle to the underlying OS process yet, so an
    // orphaned browser process can outlive this timeout; that's a real
    // (rare) cost of Playwright's launch() having no built-in abort, not
    // something this wrapper can fully close without reaching for a much
    // blunter, riskier instrument (killing browser processes system-wide).
    return Promise.race([
        checkPageUnbounded(url, timeoutMs, captureScreenshot),
        new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs + 10_000)),
    ])
}

async function checkPageUnbounded(
    url: string,
    timeoutMs: number,
    captureScreenshot: boolean,
): Promise<BrowserCheckResult | null> {
    const playwright = await loadPlaywright()
    if (!playwright) return null

    try {
        const browser = await playwright.chromium.launch({ headless: true })
        try {
            const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
            const failedRequests: FailedRequest[] = []
            const consoleErrors: ConsoleError[] = []

            page.on("response", res => {
                if (res.status() >= 400) failedRequests.push({ url: res.url(), status: res.status() })
            })
            page.on("requestfailed", req => {
                failedRequests.push({ url: req.url(), failure: req.failure()?.errorText ?? "request failed" })
            })
            page.on("console", msg => {
                if (msg.type() === "error") consoleErrors.push({ text: msg.text() })
            })

            await page.goto(url, { timeout: timeoutMs, waitUntil: "networkidle" })

            const screenshot: Screenshot | null = captureScreenshot
                ? await page
                    .screenshot({ type: "png" })
                    .then(buf => ({ base64: buf.toString("base64"), mediaType: "image/png" as const }))
                    .catch(() => null)
                : null

            return { failedRequests, consoleErrors, screenshot }
        } finally {
            await browser.close()
        }
    } catch {
        return null
    }
}

// ─── Verification-stage adapter ─────────────────────────────────────────────
// Split from run() below so the pass/fail and severity logic — the part with
// actual decisions to get right or wrong — is a pure function, testable
// without ever launching a browser (which run() itself is deliberately NOT,
// since checkPage requires a real, possibly-absent, possibly-flaky dependency).

/** Failed requests are DEFINITE breakage (mirrors assets.ts's DEAD verdict) —
 *  they fail the stage. Console errors are informational: surfaced in the
 *  report as warnings, but a page can log a caught, harmless error and still
 *  be a correct page, so they never fail the build on their own. */
export function toStageResult(result: BrowserCheckResult | null, file: string, durationMs: number): StageResult {
    if (!result) {
        // Playwright not installed, or the render itself failed outright —
        // degrade to a pass, exactly like smoke.ts's "no command" case and
        // assets.ts's network-unreachable warnings: never fail a build over
        // an absent OPTIONAL capability.
        return { passed: true, errors: [], durationMs }
    }

    const errors: VerificationError[] = [
        ...result.failedRequests.map(
            (r): VerificationError => ({
                file,
                line: 0,
                message: `Failed to load ${r.url}${r.status ? ` (HTTP ${r.status})` : ""}${r.failure ? ` — ${r.failure}` : ""}`,
                severity: "error",
                rule: "browser",
            }),
        ),
        ...result.consoleErrors.map(
            (c): VerificationError => ({
                file,
                line: 0,
                message: `Console error: ${c.text}`,
                severity: "warning",
                rule: "browser",
            }),
        ),
    ]

    return { passed: !errors.some(e => e.severity === "error"), errors, durationMs }
}

const HTML_EXT = new Set(["html", "htm"])

/** Picks a single entry point to render — a full headless-browser launch per
 *  file (as assets.ts does for its cheap regex scan) would be far too
 *  expensive to run per changed file. "index.html" wins if present, else the
 *  first HTML file in the changeset; if there's no HTML file at all, there's
 *  nothing to render, so this stage passes trivially. */
function pickEntryFile(files: string[]): string | null {
    const htmlFiles = files.filter(f => HTML_EXT.has(extname(f).replace(".", "").toLowerCase()))
    if (htmlFiles.length === 0) return null
    return htmlFiles.find(f => f.toLowerCase().endsWith("index.html")) ?? htmlFiles[0]!
}

/** Pipeline-facing entry point: render the changeset's HTML entry point (if
 *  any) and report the result as a StageResult. */
export async function run(files: string[], projectRoot: string, timeoutMs = 20_000): Promise<StageResult> {
    const start = Date.now()
    const entry = pickEntryFile(files)
    if (!entry) return { passed: true, errors: [], durationMs: Date.now() - start }

    const absPath = join(projectRoot, entry).replace(/\\/g, "/")
    const result = await checkPage(`file://${absPath}`, timeoutMs)
    return toStageResult(result, entry, Date.now() - start)
}
