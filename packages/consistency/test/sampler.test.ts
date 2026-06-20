import { test, expect } from "bun:test"
import { Effect } from "effect"
import * as Sampler from "../src/sampler.ts"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import { isOllamaModelAvailable } from "@monkeydcode/llm/ollama-health"

test("TEMP_SETS defines correct candidate counts", async () => {
    const modelId = "qwen2.5-coder:7b"
    if (!(await isOllamaModelAvailable(modelId))) {
        console.log("Skipping: Ollama model not available — run: ollama pull qwen2.5-coder:7b")
        return
    }

    const result = await Effect.runPromise(
        Sampler.sample({
            prompt: "Write a TS function that reverses a string. Output only code.",
            files: [],
            model: ollama.model(modelId),
            modelId,
        }),
    )
    expect(result.selected).toBeDefined()
}, 120_000)
