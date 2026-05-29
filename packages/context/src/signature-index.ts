import { Effect } from "effect"
import { treeSitter } from "@monkeydcode/python-bridge/client"

export interface Signature {
    name: string
    parameters: string
    line: number
    file: string
    type: "function" | "method" | "class"
}

export function indexProject(rootDir: string) {
    return Effect.gen(function* () {
        const files = yield* findSourceFiles(rootDir)
        const index = new Map<string, Signature[]>()
        for (const file of files) {
            const sigs = yield* treeSitter.extractSignatures(file)
            index.set(file, sigs.map(s => ({ ...s, file })))
        }
        return index
    })
}
