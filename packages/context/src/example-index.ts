/** Example index — code patterns for few-shot context. */
import { Effect } from "effect"
import * as VectorStore from "./vector_store.ts"

export interface CodeExample {
    text: string
    file?: string
    score: number
}

export function findExamples(query: string, limit = 5): Effect.Effect<CodeExample[], unknown> {
    return Effect.map(
        VectorStore.search(query, limit),
        results => results.map(r => ({ text: r.text, score: r.score })),
    )
}

export function indexFromFiles(files: string[]): Effect.Effect<void, unknown> {
    return VectorStore.indexFiles(files)
}
