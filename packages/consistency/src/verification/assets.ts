// Asset-reference validation — the capability the agent structurally lacked.
//
// A whole class of real bugs ("the logo shows a broken placeholder", "the
// stylesheet 404s", "that CDN script is dead") are invisible to a code-only,
// `bun test`-driven verifier: there is no unit test for "this <img> loads".
// The failure lives in a *reference to an external resource*, verified by
// resolving the reference — an HTTP request for remote URLs, a filesystem
// check for local paths — not by executing code.
//
// This module extracts those references from HTML/CSS/Markdown and validates
// them. It is deliberately pure of any agent/LLM concern so it can serve BOTH
// the verification pipeline (a fix must leave every reference resolvable) and
// the tool loop (the model can discover a dead reference before it edits).

import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { resolve, dirname, isAbsolute, relative } from "path"
import type { StageResult, VerificationError } from "./types.ts"

export interface AssetRef {
    /** Source file (project-relative) the reference was found in. */
    file: string
    line: number
    /** The URL/path exactly as authored. */
    raw: string
    kind: "external" | "local"
    /** Where it came from, e.g. "img[src]", "link[href]", "css url()", "md image". */
    origin: string
}

export interface AssetCheckResult {
    ref: AssetRef
    ok: boolean
    /** HTTP status for external refs, when a response was received. */
    status?: number
    /** Human-readable outcome: "200", "404 Not Found", "missing file", "unreachable". */
    reason: string
    severity: "error" | "warning"
}

const EXTERNAL_TIMEOUT_MS = 6_000
const MAX_EXTERNAL_CHECKS = 40
/** File extensions whose contents can carry asset references. */
const REF_BEARING_EXT = new Set(["html", "htm", "css", "md", "markdown", "svg", "xml"])

function extOf(file: string): string {
    const m = /\.([a-z0-9]+)$/i.exec(file)
    return m ? m[1]!.toLowerCase() : ""
}

/** Schemes/prefixes that are never a fetchable asset — skip them entirely. */
function isIgnorable(url: string): boolean {
    const u = url.trim()
    if (u === "" || u.startsWith("#")) return true
    return /^(data:|mailto:|tel:|javascript:|blob:|about:|\{\{|\$\{|<%)/i.test(u)
}

function classify(url: string): "external" | "local" {
    return /^(https?:)?\/\//i.test(url.trim()) ? "external" : "local"
}

// ─── Reference extraction ──────────────────────────────────────────────────

/**
 * Pull asset references out of one file's text. Regex-based on purpose: it must
 * tolerate broken/partial markup (the very thing we are trying to catch) and
 * never throw. Returns references with 1-based line numbers.
 */
export function extractRefs(text: string, file: string): AssetRef[] {
    const refs: AssetRef[] = []
    const lines = text.split("\n")

    const push = (raw: string, origin: string, lineIdx: number) => {
        if (isIgnorable(raw)) return
        refs.push({ file, line: lineIdx + 1, raw: raw.trim(), kind: classify(raw), origin })
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!

        // HTML/SVG: src="..." and href="..." (single or double quoted).
        for (const m of line.matchAll(/\b(src|href)\s*=\s*["']([^"']+)["']/gi)) {
            push(m[2]!, `${m[1]!.toLowerCase()} attribute`, i)
        }
        // srcset="a.png 1x, b.png 2x" — validate each candidate URL.
        for (const m of line.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
            for (const part of m[1]!.split(",")) {
                const url = part.trim().split(/\s+/)[0]
                if (url) push(url, "img[srcset]", i)
            }
        }
        // CSS: url(...) with optional quotes.
        for (const m of line.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
            push(m[1]!, "css url()", i)
        }
        // Markdown image/link: ![alt](url) / [text](url).
        for (const m of line.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)) {
            push(m[1]!, "md image", i)
        }
    }
    return refs
}

// ─── Validation ─────────────────────────────────────────────────────────────

async function checkExternal(ref: AssetRef): Promise<AssetCheckResult> {
    const url = ref.raw.startsWith("//") ? `https:${ref.raw}` : ref.raw
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS)
    try {
        let res: Response
        try {
            res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal })
            // Some CDNs reject HEAD (405/501) — fall back to a ranged GET.
            if (res.status === 405 || res.status === 501) {
                res = await fetch(url, {
                    method: "GET",
                    redirect: "follow",
                    signal: controller.signal,
                    headers: { Range: "bytes=0-0" },
                })
            }
        } catch {
            res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal })
        }
        if (res.status >= 400) {
            return { ref, ok: false, status: res.status, reason: `${res.status} ${res.statusText}`.trim(), severity: "error" }
        }
        return { ref, ok: true, status: res.status, reason: String(res.status), severity: "error" }
    } catch {
        // DNS failure, connection refused, or timeout. A dead host is a real
        // error; but a transient network blip on a good URL shouldn't fail a
        // build, so this is a WARNING — surfaced, never fatal to verification.
        return { ref, ok: false, reason: "unreachable (network error/timeout)", severity: "warning" }
    } finally {
        clearTimeout(timer)
    }
}

function checkLocal(ref: AssetRef, projectRoot: string): AssetCheckResult {
    // Strip query/hash — "logo.svg?v=2" and "sprite.svg#icon" resolve to a file.
    const cleaned = ref.raw.replace(/[?#].*$/, "")
    const base = ref.raw.startsWith("/")
        ? resolve(projectRoot, `.${cleaned}`) // root-absolute → relative to project root
        : resolve(dirname(resolve(projectRoot, ref.file)), cleaned)
    if (existsSync(base)) {
        return { ref, ok: true, reason: "ok", severity: "error" }
    }
    return { ref, ok: false, reason: "missing file", severity: "error" }
}

/**
 * Validate every asset reference in `files` (only ref-bearing types are read).
 * External URLs are de-duplicated and capped so a page full of the same CDN
 * link is one request, not hundreds.
 */
export async function validateAssets(files: string[], projectRoot: string): Promise<AssetCheckResult[]> {
    const targets = files.filter(f => REF_BEARING_EXT.has(extOf(f)))
    const allRefs: AssetRef[] = []
    for (const f of targets) {
        const abs = isAbsolute(f) ? f : resolve(projectRoot, f)
        try {
            const text = await readFile(abs, "utf-8")
            const relPath = relative(projectRoot, abs).replace(/\\/g, "/") || f
            allRefs.push(...extractRefs(text, relPath))
        } catch {
            // Unreadable file — nothing to validate here.
        }
    }

    const results: AssetCheckResult[] = []

    // Local refs: cheap, synchronous, unbounded.
    for (const ref of allRefs.filter(r => r.kind === "local")) {
        results.push(checkLocal(ref, projectRoot))
    }

    // External refs: dedupe by URL, cap count, run concurrently.
    const external = allRefs.filter(r => r.kind === "external")
    const seen = new Map<string, AssetRef>()
    for (const r of external) if (!seen.has(r.raw)) seen.set(r.raw, r)
    const unique = [...seen.values()].slice(0, MAX_EXTERNAL_CHECKS)
    const checked = await Promise.all(unique.map(checkExternal))
    const byUrl = new Map(checked.map(c => [c.ref.raw, c]))
    // Re-expand deduped results back onto every occurrence, so the report points
    // at each real location the dead URL appears.
    for (const ref of external) {
        const c = byUrl.get(ref.raw)
        if (c) results.push({ ...c, ref })
    }

    return results
}

// ─── Verification-stage adapter ─────────────────────────────────────────────

/**
 * Pipeline stage: fails only on DEFINITE breakage (a local file that doesn't
 * exist, or a remote URL that returned 4xx/5xx). Network-unreachable results
 * are warnings and never fail the build — we won't punish a correct fix for a
 * flaky connection.
 */
export async function check(files: string[], projectRoot: string, timeoutMs = 20_000): Promise<StageResult> {
    const start = Date.now()
    const results = await Promise.race([
        validateAssets(files, projectRoot),
        new Promise<AssetCheckResult[]>(res => setTimeout(() => res([]), timeoutMs)),
    ])

    const errors: VerificationError[] = results
        .filter(r => !r.ok && r.severity === "error")
        .map(r => ({
            file: r.ref.file,
            line: r.ref.line,
            message: `Broken asset reference (${r.ref.origin}): "${r.ref.raw}" — ${r.reason}`,
            severity: "error" as const,
            rule: "assets",
        }))

    return { passed: errors.length === 0, errors, durationMs: Date.now() - start }
}

/** One-line-per-ref human report — used by the tool loop's investigation output. */
export function formatReport(results: AssetCheckResult[]): string {
    if (results.length === 0) return "No asset references found."
    const lines = results.map(r => {
        const mark = r.ok ? "OK  " : r.severity === "warning" ? "WARN" : "DEAD"
        return `[${mark}] ${r.ref.file}:${r.ref.line} ${r.ref.origin} → ${r.ref.raw}  (${r.reason})`
    })
    const dead = results.filter(r => !r.ok && r.severity === "error").length
    const header = dead > 0 ? `${dead} broken reference(s):\n` : "All references resolve:\n"
    return header + lines.join("\n")
}
