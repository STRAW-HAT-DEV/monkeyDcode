/**
 * Repo map — ROADMAP.md §5.1.
 *
 * A compact file tree (path + one-line role) handed to the planner so it
 * references files that actually exist instead of inventing plausible-looking
 * paths. Capped at MAX_ENTRIES lines so it stays cheap to include in every
 * plan prompt regardless of project size.
 *
 * Cached per project root with a short TTL — the map is only read once per
 * plan() call, so exact freshness doesn't matter within a single task, but
 * re-scanning the whole tree on every message in a session would be wasteful.
 * `invalidate()` is exposed for callers that know the tree just changed
 * (e.g. the orchestrator after a task writes files) and want the next plan
 * to see it immediately rather than waiting out the TTL.
 */
import { existsSync, readdirSync, readFileSync } from "fs"
import { extname, join, relative } from "path"

const IGNORED_DIR_SEGMENTS = new Set([
    "node_modules", ".git", "dist", "build", ".monkeydcode", ".venv", "__pycache__", "coverage",
])
const RELEVANT_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "py", "go", "rs"])
const MAX_ENTRIES = 100
/** Safety bound on directory entries visited — the pruning walk skips ignored
 *  dirs entirely, so this only trips on genuinely enormous source trees. */
const MAX_TRAVERSAL = 50_000
const CACHE_TTL_MS = 60_000

interface CacheEntry {
    text: string
    generatedAt: number
}

const cache = new Map<string, CacheEntry>()

export function invalidate(root: string): void {
    cache.delete(root)
}

/** Compact "path — role" map for `root`, capped at MAX_ENTRIES lines. */
export async function generate(root: string): Promise<string> {
    const cached = cache.get(root)
    if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) return cached.text

    const entries = collectEntries(root)
    const text = entries.length > 0
        ? entries.map(e => (e.role ? `${e.path} — ${e.role}` : e.path)).join("\n")
        : "(no source files found)"

    cache.set(root, { text, generatedAt: Date.now() })
    return text
}

interface Entry {
    path: string
    role: string
}

/**
 * Pruning breadth-first walk. Skips ignored directories at the directory level
 * (never descends into node_modules etc.), so the traversal budget is spent on
 * real source rather than exhausted inside dependencies — and BFS surfaces
 * shallow, structurally-significant files first. The full candidate set is
 * collected and prioritized BEFORE truncating to the line budget, so a
 * critical file is never dropped merely because of where it sits in the walk.
 */
function collectEntries(root: string): Entry[] {
    if (!existsSync(root)) return []

    const candidates: string[] = []
    const queue: string[] = [root]
    let traversed = 0

    while (queue.length > 0 && traversed < MAX_TRAVERSAL) {
        const dir = queue.shift()!
        let dirents: import("fs").Dirent[]
        try {
            dirents = readdirSync(dir, { withFileTypes: true })
        } catch {
            continue // unreadable dir — skip, don't abort the whole walk
        }
        for (const entry of dirents) {
            if (++traversed > MAX_TRAVERSAL) break
            if (entry.isDirectory()) {
                if (IGNORED_DIR_SEGMENTS.has(entry.name) || entry.name.startsWith(".")) continue
                queue.push(join(dir, entry.name))
            } else if (entry.isFile()) {
                const ext = extname(entry.name).replace(".", "").toLowerCase()
                if (entry.name === "package.json" || RELEVANT_EXTENSIONS.has(ext)) {
                    candidates.push(relative(root, join(dir, entry.name)))
                }
            }
        }
    }

    // Prioritize package.json manifests (they carry real "what is this" role
    // info) and shallower paths (more likely to be structurally significant),
    // THEN truncate to the line budget.
    candidates.sort((a, b) => {
        const aManifest = a.endsWith("package.json") ? 0 : 1
        const bManifest = b.endsWith("package.json") ? 0 : 1
        if (aManifest !== bManifest) return aManifest - bManifest
        return a.split(/[\\/]/).length - b.split(/[\\/]/).length
    })

    return candidates.slice(0, MAX_ENTRIES).map(rel => ({
        path: rel.replace(/\\/g, "/"),
        role: inferRole(root, rel),
    }))
}

/** One-line "what is this file" — package.json description/name, or the
 *  first leading comment line in a source file. Best-effort; "" if nothing
 *  usable is found (the path alone is still useful signal). */
function inferRole(root: string, relPath: string): string {
    try {
        const full = `${root}/${relPath}`.replace(/\\/g, "/")
        const content = readFileSync(full, "utf-8")

        if (relPath.endsWith("package.json")) {
            const pkg = JSON.parse(content)
            if (typeof pkg.description === "string" && pkg.description.trim()) {
                return pkg.description.trim().slice(0, 80)
            }
            if (typeof pkg.name === "string") return `package: ${pkg.name}`
            return ""
        }

        for (const line of content.split("\n").slice(0, 8)) {
            const t = line.trim()
            const m = /^(?:\/\/|#|\*|\/\*\*?)\s*(.+?)\s*\*?\/?$/.exec(t)
            const text = m?.[1]
            if (text && text.length > 3 && !/^eslint|^@ts-|^prettier/i.test(text)) {
                return text.slice(0, 80)
            }
        }
    } catch {
        // Unreadable/binary/malformed JSON — no role, path alone is still useful.
    }
    return ""
}
