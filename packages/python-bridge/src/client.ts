import { readFile } from "fs/promises"
import { call, ping } from "./bridge.ts"

export interface Signature {
    name: string
    parameters: string
    line: number
    type: "function" | "method" | "class"
}

function regexExtractSignatures(file: string, source: string): Signature[] {
    const sigs: Signature[] = []
    const patterns = [
        /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))/g,
        /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
        /def\s+(\w+)\s*(\([^)]*\))/g,
    ]
    const lines = source.split("\n")
    for (const pattern of patterns) {
        let m: RegExpExecArray | null
        while ((m = pattern.exec(source)) !== null) {
            const before = source.slice(0, m.index)
            const line = before.split("\n").length
            sigs.push({
                name: m[1]!,
                parameters: m[2] ?? "()",
                line,
                type: "function",
            })
        }
    }
    if (sigs.length === 0 && lines.length > 0) {
        // class methods fallback
        const classPat = /(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/g
        let m: RegExpExecArray | null
        while ((m = classPat.exec(source)) !== null) {
            if (["if", "for", "while", "switch", "catch"].includes(m[1]!)) continue
            const line = source.slice(0, m.index).split("\n").length
            sigs.push({ name: m[1]!, parameters: "()", line, type: "method" })
        }
    }
    return sigs
}

async function bridgeExtract(file: string): Promise<Signature[]> {
    return call<Signature[]>("treeSitter.extractSignatures", { file })
}

async function bridgeAlive(): Promise<boolean> {
    try {
        return await Promise.race([
            ping(),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2_000)),
        ])
    } catch {
        return false
    }
}

export const treeSitter = {
    extractSignatures: async (file: string): Promise<Signature[]> => {
        try {
            if (await bridgeAlive()) return await bridgeExtract(file)
        } catch { /* fall through */ }
        const source = await readFile(file, "utf-8")
        return regexExtractSignatures(file, source)
    },

    parseAST: async (file: string): Promise<Record<string, unknown>> => {
        try {
            return await call<Record<string, unknown>>("treeSitter.parseAST", { file })
        } catch {
            const source = await readFile(file, "utf-8")
            return { file, type: "fallback", lineCount: source.split("\n").length }
        }
    },
}
