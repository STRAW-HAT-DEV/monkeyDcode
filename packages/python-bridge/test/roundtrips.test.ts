test("ping roundtrip", async () => {
    const program = Effect.gen(function* () {
        const bridge = yield* PythonBridge
        return yield* bridge.call<string>("ping")
    })
    const result = await Effect.runPromise(Effect.provide(program, live))
    expect(result).toBe("pong")
})

test("extract signatures from TS", async () => {
    await writeFile("/tmp/sample.ts", `
        export function foo(x: number): number { return x + 1 }
    `)
    const program = treeSitter.extractSignatures("/tmp/sample.ts")
    const result = await Effect.runPromise(Effect.provide(program, live))
    expect(result[0]!.name).toBe("foo")
})
