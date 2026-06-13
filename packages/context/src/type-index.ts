/** Type index — exported types and interfaces from source files. */
import { Effect } from "effect"
import { readFile } from "fs/promises"
import { call } from "@monkeydcode/python-bridge/bridge"

export interface TypeEntry {
    name: string
    kind: "interface" | "type" | "class" | "enum"
    file: string
    line: number
}

export function indexFile(file: string): Effect.Effect<TypeEntry[], unknown> {
    return Effect.tryPromise(async () => {
        const source = await readFile(file, "utf-8")
        const entries: TypeEntry[] = []
        const patterns: Array<[RegExp, TypeEntry["kind"]]> = [
            [/export\s+(?:type|interface)\s+(\w+)/g, "interface"],
            [/export\s+class\s+(\w+)/g, "class"],
            [/export\s+enum\s+(\w+)/g, "enum"],
        ]
        for (const [pat, kind] of patterns) {
            let m: RegExpExecArray | null
            while ((m = pat.exec(source)) !== null) {
                entries.push({
                    name: m[1]!,
                    kind,
                    file,
                    line: source.slice(0, m.index).split("\n").length,
                })
            }
        }
        try {
            const ast = await call<{ types?: TypeEntry[] }>("treeSitter.parseAST", { file })
            if (ast?.types?.length) return ast.types
        } catch { /* regex fallback above */ }
        return entries
    })
}

export function indexProject(rootDir: string): Effect.Effect<TypeEntry[], unknown> {
    return Effect.tryPromise(async () => {
        const glob = new Bun.Glob("**/*.{ts,tsx}")
        const all: TypeEntry[] = []
        for await (const f of glob.scan({ cwd: rootDir, absolute: true })) {
            if (f.includes("node_modules") || f.includes(".git")) continue
            const entries = await Effect.runPromise(indexFile(f))
            all.push(...entries)
        }
        return all
    })
}
