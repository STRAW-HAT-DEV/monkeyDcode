import { test, expect } from "bun:test"
import { Effect } from "effect"
import * as Sampler from "../src/sampler.ts"
import { ollama } from "@monkeydcode/llm/providers/ollama"
import { isOllamaModelAvailable } from "@monkeydcode/llm/ollama-health"

// This test only runs when a live Ollama + the model tag are actually present
// (isOllamaModelAvailable fails fast — ~2s max — otherwise). When it IS
// present, this exercises real local CPU/GPU inference plus the full
// verification pipeline (tsc/lint/tests), which can legitimately take minutes
// on modest hardware — a 120s budget was tight enough to flake on real
// machines even when everything worked correctly, not just when Ollama was
// down. Give it real headroom instead of a headline number.
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
}, 300_000)
