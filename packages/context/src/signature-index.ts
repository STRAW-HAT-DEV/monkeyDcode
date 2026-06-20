import { Effect } from "effect"
import { treeSitter } from "@monkeydcode/python-bridge/client"

export interface Signature {
    name: string
    parameters: string
    line: number
    file: string
    type: "function" | "method" | "class"
}

export function extractSignatures(file: string): Effect.Effect<Signature[], unknown> {
    return Effect.tryPromise(async () => {
        const sigs = await treeSitter.extractSignatures(file)
        return sigs.map(s => ({ ...s, file }))
    })
}

export function indexProject(rootDir: string): Effect.Effect<Map<string, Signature[]>, unknown> {
    return Effect.gen(function* () {
        const files = yield* findSourceFiles(rootDir)
        const index = new Map<string, Signature[]>()
        for (const f of files) {
            const sigs = yield* extractSignatures(f)
            index.set(f, sigs)
        }
        return index
    })
}

function findSourceFiles(rootDir: string): Effect.Effect<string[], unknown> {
    return Effect.tryPromise(async () => {
        const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,py}")
        const files: string[] = []
        for await (const f of glob.scan({ cwd: rootDir, absolute: true })) {
            if (!f.includes("node_modules") && !f.includes(".git")) files.push(f)
        }
        return files
    })
}
