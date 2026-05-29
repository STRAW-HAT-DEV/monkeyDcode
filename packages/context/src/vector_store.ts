// EXPERIMENTAL: semantic code search delegated to the Python bridge
// (chromadb + sentence-transformers). Requires the optional Python deps.

import { PythonBridge } from "@monkeydcode/python-bridge"
import { Effect } from "effect"

export function indexFiles(files: string[]) {
    return Effect.gen(function* () {
        const bridge = yield* PythonBridge
        yield* bridge.call("vectorStore.index", { files })
    })
}

export function search(query: string, k = 5) {
    return Effect.gen(function* () {
        const bridge = yield* PythonBridge
        return yield* bridge.call<{ text: string; score: number }[]>("vectorStore.search", { query, k })
    })
}
