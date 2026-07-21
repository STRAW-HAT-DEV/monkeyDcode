// Deterministic asset-reference fixer.
//
// Routing a "the logo won't render" task to the general planner isn't enough:
// a weak model won't reliably choose to RUN check-assets, find the right file,
// and edit it — it wrote a stray test file instead. So this sub-agent does the
// finding itself, and reduces the model's job to the smallest possible thing.
//
// Key design choice: we do NOT ask the model to rewrite the whole file. A weak
// model asked to reproduce a 100-line HTML page perfectly will echo it, truncate
// it, or mangle unrelated parts — which is exactly what happened (it produced no
// usable change). Instead, for each broken reference we ask only for a REPLACEMENT
// VALUE (a working URL or a data: URI), and perform the substitution ourselves.
// The model produces one short string it can actually get right; the edit is a
// deterministic string replace, so the rest of the file is untouched by
// construction. The result is re-validated, and a still-dead reference triggers
// one more round with pointed feedback.

import { Effect } from "effect"
import { readFile, writeFile } from "fs/promises"
import { resolve, isAbsolute } from "path"
import { LLM } from "@monkeydcode/llm"
import type { ModelRef } from "@monkeydcode/llm"
import { ensureParentDir } from "@monkeydcode/core/util/path"
import { validateAssets, type AssetCheckResult } from "@monkeydcode/consistency/verification/assets"
import * as Status from "../status.ts"
import * as Changes from "../changes.ts"

const MAX_ROUNDS = 2
const ASSET_FILE_EXT = new Set(["html", "htm", "css", "md", "markdown", "svg"])
const IGNORED = ["node_modules", ".git", "dist", "build", ".monkeydcode"]

export interface AssetFixOutcome {
    /** Were any DEFINITELY-broken references found (dead URL / missing file)? If
     *  false, the reported problem is not a dead reference — caller should fall back. */
    hadBrokenRefs: boolean
    /** Do all references resolve after the fix? */
    fixed: boolean
    /** Human-readable account of what was found and done — surfaced to the user
     *  so "No file changes" is never a silent dead end. */
    summary: string
}

export function fix(
    task: string,
    model: ModelRef,
    projectRoot: string,
): Effect.Effect<AssetFixOutcome, unknown> {
    return Effect.gen(function* () {
        const files = yield* Effect.promise(() => findAssetFiles(projectRoot))
        if (files.length === 0) {
            return { hadBrokenRefs: false, fixed: false, summary: "No HTML/CSS/Markdown files found to check." }
        }

        const initial = yield* Effect.promise(() => validateAssets(files, projectRoot))
        const notOk = initial.filter(r => !r.ok)
        let broken = notOk.filter(r => r.severity === "error")

        if (broken.length === 0) {
            // Nothing definitively dead. Report any warnings (unreachable/slow) so
            // a network issue isn't mistaken for "everything's fine".
            const warnings = notOk.filter(r => r.severity === "warning")
            const summary = warnings.length > 0
                ? `No dead references, but ${warnings.length} could not be reached (possible network issue):\n${listRefs(warnings)}`
                : "All asset references resolve — the problem isn't a broken reference."
            return { hadBrokenRefs: false, fixed: false, summary }
        }

        Status.emit({ agent: "franky", action: `Fixing ${broken.length} broken asset reference(s)...` })
        const foundSummary = `Found ${broken.length} broken reference(s):\n${listRefs(broken)}`

        for (let round = 0; round < MAX_ROUNDS; round++) {
            for (const [file, refs] of groupByFile(broken)) {
                const abs = isAbsolute(file) ? file : resolve(projectRoot, file)
                let content = yield* Effect.promise(() => readFile(abs, "utf-8").catch(() => ""))
                if (!content) continue
                const original = content

                for (const r of refs) {
                    const prompt = buildReplacementPrompt(task, r, round)
                    const response = yield* Effect.promise(() =>
                        LLM.generateAsync({ model, messages: [{ role: "user", content: prompt }] }),
                    )
                    const replacement = sanitizeReplacement(response.text)
                    if (!replacement || replacement === r.ref.raw) continue
                    // Deterministic, surgical: swap only the broken reference
                    // string; everything else in the file is preserved verbatim.
                    content = content.split(r.ref.raw).join(replacement)
                }

                if (content !== original) {
                    yield* Effect.promise(async () => {
                        await ensureParentDir(abs)
                        await writeFile(abs, content)
                    })
                    Changes.recordWrite(abs)
                }
            }

            broken = (yield* Effect.promise(() => validateAssets(files, projectRoot)))
                .filter(r => !r.ok && r.severity === "error")
            if (broken.length === 0) {
                return { hadBrokenRefs: true, fixed: true, summary: `${foundSummary}\nAll fixed — every reference now resolves.` }
            }
        }

        return {
            hadBrokenRefs: true,
            fixed: false,
            summary: `${foundSummary}\nCould not produce a working replacement after ${MAX_ROUNDS} attempts. Still broken:\n${listRefs(broken)}`,
        }
    })
}

function listRefs(refs: AssetCheckResult[]): string {
    return refs.map(r => `  • ${r.ref.file}:${r.ref.line} (${r.ref.origin}) "${r.ref.raw}" — ${r.reason}`).join("\n")
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function findAssetFiles(root: string): Promise<string[]> {
    const glob = new Bun.Glob("**/*")
    const files: string[] = []
    for await (const rel of glob.scan({ cwd: root, dot: false })) {
        if (IGNORED.some(seg => rel.includes(`${seg}/`) || rel.includes(`${seg}\\`))) continue
        const ext = rel.split(".").pop()?.toLowerCase() ?? ""
        if (ASSET_FILE_EXT.has(ext)) files.push(rel)
        if (files.length >= 200) break
    }
    return files
}

function groupByFile(broken: AssetCheckResult[]): Map<string, AssetCheckResult[]> {
    const map = new Map<string, AssetCheckResult[]>()
    for (const r of broken) {
        const arr = map.get(r.ref.file) ?? []
        arr.push(r)
        map.set(r.ref.file, arr)
    }
    return map
}

function buildReplacementPrompt(task: string, r: AssetCheckResult, round: number): string {
    const retryNote = round > 0
        ? "Your previous replacement was ALSO broken. Do NOT reuse it. This time output a " +
          "data: URI (e.g. a tiny inline SVG encoded as data:image/svg+xml,...) so it CANNOT fail.\n\n"
        : ""

    return [
        `A web page has a broken asset reference that shows an empty placeholder.`,
        `User request: ${task}`,
        "",
        `Broken reference: ${r.ref.raw}`,
        `Found in: ${r.ref.file}:${r.ref.line} (${r.ref.origin})`,
        `Problem: ${r.reason}`,
        "",
        retryNote +
        "Give a WORKING replacement value to put directly in place of the broken one " +
        "(it goes straight into the src/href attribute). Rules:",
        "- If you recognise the intended asset (e.g. a brand logo), use a URL you are highly",
        "  confident returns HTTP 200, or an inline data: URI.",
        "- Prefer a data: URI when unsure, so it can never 404.",
        "- Output ONLY the replacement value on a single line: no quotes, no markdown, no",
        "  explanation, no surrounding text.",
    ].join("\n")
}

/** Pull a clean single-value replacement out of a model response: first
 *  non-empty line, stripped of quotes/backticks/markdown noise. Rejects prose. */
function sanitizeReplacement(text: string): string | null {
    // Prefer a fenced value if the model wrapped it despite instructions.
    const fenced = text.match(/```(?:[\w-]+)?\n?([\s\S]*?)```/)
    const body = (fenced?.[1] ?? text).trim()
    const firstLine = body.split("\n").map(l => l.trim()).find(l => l.length > 0) ?? ""
    const cleaned = firstLine.replace(/^["'`]+|["'`]+$/g, "").replace(/^src\s*=\s*/i, "").trim()
    if (cleaned.length === 0) return null
    // Must look like a usable asset value, not an apology or a sentence.
    const looksValid = /^(https?:\/\/|\/\/|\.?\/|data:|[\w.-]+\.\w+)/i.test(cleaned) && !/\s/.test(cleaned.slice(0, 8))
    if (!looksValid || cleaned.length > 4000) return null
    return cleaned
}
