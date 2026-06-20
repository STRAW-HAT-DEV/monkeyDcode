import { test, expect } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../src/llm.ts"
import { ollama } from "../src/providers/ollama.ts"
import { isOllamaModelAvailable } from "../src/ollama-health.ts"

test("ollama provider is registered", () => {
    const model = ollama.model("qwen2.5-coder:7b")
    expect(model.provider).toBe("ollama")
    expect(model.id).toBe("qwen2.5-coder:7b")
})

test("ollama responds to simple prompt", async () => {
    const modelId = "qwen2.5-coder:7b"
    if (!(await isOllamaModelAvailable(modelId))) {
        console.log("Skipping: Ollama model not available — run: ollama pull qwen2.5-coder:7b")
        return
    }

    const program = Effect.gen(function* () {
        const response = yield* LLM.generate({
            model: ollama.model(modelId),
            messages: [{ role: "user", content: "Say hello in 3 words" }],
            temperature: 0.3,
        })
        return response.text
    })
    const result = await Effect.runPromise(program)
    expect(result).toBeTruthy()
    expect(result.length).toBeGreaterThan(0)
}, 60_000)
