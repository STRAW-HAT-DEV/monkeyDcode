import { contentTag, normalizeContent, verifyLineFingerprints } from "./hash.ts"
import { formatEditResponse } from "./format.ts"
import { parsePatch } from "./parse.ts"
import { globalSnapshotStore, type SnapshotStore } from "./snapshot.ts"
import type { ApplyOptions, ApplyResult, HashlineOp, HashlineSection } from "./types.ts"

function absorbAnchorEcho(lines: string[], afterLine: number, body: string[]): string[] {
    if (body.length === 0 || afterLine < 1) return body
    const anchor = lines[afterLine - 1]
    if (anchor !== undefined && body[0] === anchor) return body.slice(1)
    return body
}

function applyOps(originalLines: string[], ops: HashlineOp[]): { lines: string[]; changed: number[] } {
    const lines = [...originalLines]
    const changed = new Set<number>()

    // Sort ops by descending start line — original line numbers stay stable
    const sorted = [...ops].sort((a, b) => {
        const la = a.kind === "insert" ? (a.position === "head" ? 0 : a.line) : a.start
        const lb = b.kind === "insert" ? (b.position === "head" ? 0 : b.line) : b.start
        return lb - la
    })

    for (const op of sorted) {
        if (op.kind === "replace") {
            const startIdx = op.start - 1
            const endIdx = op.end - 1
            lines.splice(startIdx, endIdx - startIdx + 1, ...op.lines)
            for (let n = op.start; n < op.start + op.lines.length; n++) changed.add(n)
        } else if (op.kind === "delete") {
            lines.splice(op.start - 1, op.end - op.start + 1)
            changed.add(op.start)
        } else if (op.kind === "insert") {
            let body = op.lines
            if (op.position === "head") {
                lines.unshift(...body)
                for (let n = 1; n <= body.length; n++) changed.add(n)
            } else if (op.position === "tail") {
                const at = lines.length + 1
                lines.push(...body)
                for (let n = at; n < at + body.length; n++) changed.add(n)
            } else if (op.position === "before") {
                lines.splice(op.line - 1, 0, ...body)
                for (let n = op.line; n < op.line + body.length; n++) changed.add(n)
            } else if (op.position === "after") {
                body = absorbAnchorEcho(lines, op.line, body)
                lines.splice(op.line, 0, ...body)
                for (let n = op.line + 1; n <= op.line + body.length; n++) changed.add(n)
            }
        }
    }

    return { lines, changed: [...changed].sort((a, b) => a - b) }
}

function preflightSection(
    section: HashlineSection,
    snapshotPath: string,
    content: string,
    store: SnapshotStore,
    strictTag: boolean,
    strictLines: boolean,
): { ok: boolean; error?: string; stale?: boolean } {
    const norm = normalizeContent(content)
    const prevTag = contentTag(norm)

    if (strictTag) {
        const tagCheck = store.verifyTag(snapshotPath, section.tag, norm)
        if (!tagCheck.ok) {
            return {
                ok: false,
                stale: true,
                error: tagCheck.message ?? `Stale tag #${section.tag} (live #${prevTag})`,
            }
        }
    }

    const entry = store.get(snapshotPath)
    if (strictLines && entry) {
        for (const op of section.ops) {
            if (op.kind === "replace" || op.kind === "delete") {
                const v = verifyLineFingerprints(norm, op.start, op.end, entry.lineFingerprints)
                if (!v.ok) return { ok: false, stale: true, error: v.message }
            }
        }
    }

    for (const op of section.ops) {
        const lineCount = norm === "" ? 0 : norm.split("\n").length
        if (op.kind === "replace" || op.kind === "delete") {
            if (op.start < 1 || op.end < op.start || op.end > lineCount) {
                return {
                    ok: false,
                    error: `Invalid range ${op.start}..${op.end} (file has ${lineCount} lines)`,
                }
            }
        }
        if (op.kind === "insert" && (op.position === "before" || op.position === "after")) {
            if (op.line < 1 || op.line > lineCount) {
                return { ok: false, error: `Invalid insert line ${op.line} (file has ${lineCount} lines)` }
            }
        }
    }

    return { ok: true }
}

function pathsMatch(sectionPath: string, targetPath: string): boolean {
    const a = sectionPath.replace(/\\/g, "/")
    const b = targetPath.replace(/\\/g, "/")
    if (a === b) return true
    if (b.endsWith(`/${a}`) || a.endsWith(`/${b}`)) return true
    const aBase = a.split("/").pop()
    const bBase = b.split("/").pop()
    return aBase !== undefined && aBase === bBase
}

export async function applyPatch(
    patchText: string,
    options: ApplyOptions,
    store: SnapshotStore = globalSnapshotStore,
): Promise<ApplyResult> {
    const patch = parsePatch(patchText)
    if (patch.sections.length === 0) {
        return {
            ok: false,
            path: options.path,
            previousTag: contentTag(normalizeContent(options.content)),
            linesChanged: 0,
            error: "No hashline sections found. Start with [path#TAG] from read output.",
        }
    }

    const norm = normalizeContent(options.content)
    const previousTag = contentTag(norm)
    const strictTag = options.strictTag !== false
    const strictLines = options.strictLines !== false

    const section =
        patch.sections.find(s => pathsMatch(s.path, options.path)) ?? patch.sections[0]
    if (!section) {
        return {
            ok: false,
            path: options.path,
            previousTag,
            linesChanged: 0,
            error: "No matching hashline section for path",
        }
    }

    const pre = preflightSection(section, options.path, norm, store, strictTag, strictLines)
    if (!pre.ok) {
        return {
            ok: false,
            path: section.path,
            previousTag,
            linesChanged: 0,
            error: pre.error,
            stale: pre.stale,
            hint: "Re-read the file and re-anchor line numbers from the new [path#tag] header.",
        }
    }

    const originalLines = norm === "" ? [] : norm.split("\n")
    const { lines, changed } = applyOps(originalLines, section.ops)
    const nextContent = lines.join("\n")

    if (options.verifyBeforeWrite) {
        const gate = await options.verifyBeforeWrite(nextContent)
        if (!gate.ok) {
            return {
                ok: false,
                path: section.path,
                previousTag,
                linesChanged: 0,
                error: gate.message ?? "Verification gate rejected patch",
                preview: nextContent.slice(0, 500),
            }
        }
    }

    const newTag = contentTag(nextContent)
    store.record(options.path, nextContent)

    return {
        ok: true,
        path: options.path,
        content: nextContent,
        previousTag,
        newTag,
        linesChanged: changed.length,
        preview: formatEditResponse(options.path, nextContent, changed, store),
    }
}

/** Read file from disk, apply patch, return result (caller writes). */
export async function applyPatchToFile(
    patchText: string,
    filePath: string,
    readFile: (p: string) => Promise<string>,
    options?: Partial<ApplyOptions>,
    store?: SnapshotStore,
): Promise<ApplyResult> {
    const content = await readFile(filePath)
    return applyPatch(
        patchText,
        {
            content,
            path: filePath,
            ...options,
        },
        store,
    )
}
