import { Effect } from "effect"
import { call } from "@monkeydcode/python-bridge/bridge"

export function indexFiles(files: string[]) {
    return Effect.tryPromise(() => call<void>("vectorStore.index", { files }))
}

export function search(query: string, k = 5) {
    return Effect.tryPromise(() =>
        call<{ text: string; score: number }[]>("vectorStore.search", { query, k })
    )
}
