// EXPERIMENTAL: builds a per-file map of code signatures via the Python
// tree-sitter bridge. Requires the optional Python bridge to be running.

import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { treeSitter } from "@monkeydcode/python-bridge/client"
import { Effect } from "effect"

export interface Signature {
    name: string
    parameters: string
    line: number
    file: string
    type: "function" | "method" | "class"
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".py"]
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".monkeydcode"])

/** Recursively collect source files under `rootDir`, skipping vendored/build dirs. */
export function findSourceFiles(rootDir: string): Effect.Effect<string[]> {
    return Effect.tryPromise(async () => {
        const found: string[] = []
        const walk = async (dir: string): Promise<void> => {
            const entries = await readdir(dir, { withFileTypes: true })
            for (const entry of entries) {
                const full = join(dir, entry.name)
                if (entry.isDirectory()) {
                    if (!IGNORED_DIRS.has(entry.name)) await walk(full)
                } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
                    found.push(full)
                }
            }
        }
        await walk(rootDir)
        return found
    }).pipe(Effect.orElseSucceed(() => []))
}

export function indexProject(rootDir: string) {
    return Effect.gen(function* () {
        const files = yield* findSourceFiles(rootDir)
        const index = new Map<string, Signature[]>()
        for (const file of files) {
            const sigs = yield* treeSitter.extractSignatures(file)
            index.set(
                file,
                sigs.map((s) => ({ ...s, file })),
            )
        }
        return index
    })
}

/** Extract signatures for a single file, tagging each with its source path. */
export function extractSignatures(file: string) {
    return treeSitter.extractSignatures(file).pipe(Effect.map((sigs): Signature[] => sigs.map((s) => ({ ...s, file }))))
}
