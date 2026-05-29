export interface Signature {
    name: string
    parameters: string
    line: number
    type: "function" | "method" | "class"
}

export const treeSitter = {
    extractSignatures: (file: string) =>
        Effect.gen(function* () {
            const bridge = yield* PythonBridge
            return yield* bridge.call<Signature[]>("treeSitter.extractSignatures", { file })
        })
}
