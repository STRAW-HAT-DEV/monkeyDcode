import { Effect } from "effect"

export function retrieve(query: { files: string[]; description: string }) {
    return Effect.gen(function* () {
        const fileContents = yield* Effect.all(
            query.files.map(f => Effect.tryPromise(() => Bun.file(f).text())),
        )
        return { files: fileContents.join("\n---\n") }
    })
}
