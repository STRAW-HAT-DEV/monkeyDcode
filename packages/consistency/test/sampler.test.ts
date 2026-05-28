test("samples N candidates for weak model", async () => {
    const result = await Effect.runPromise(Sampler.sample({
        prompt: "Write a TS function that reverses a string",
        files: ["/tmp/reverse.ts"],
        model: ollama.model("qwen2.5-coder:7b"),
        modelId: "qwen2.5-coder:7b"
    }))
    expect(result.selected).toBeDefined()
    expect(result.confidence).toBeGreaterThan(0)
}
