export function indexFiles(files: string[]) {
    return Effect.gen(function* () {
        const bridge = yield* PythonBridge
        yield* bridge.call("vectorStore.index", { files })
    })
}

export function search(query: string, k = 5) {
    return Effect.gen(function* () {
        const bridge = yield* PythonBridge
        return yield* bridge.call<{ text: string; score: number }[]>(
            "vectorStore.search", { query, k }
        )
    })
}
