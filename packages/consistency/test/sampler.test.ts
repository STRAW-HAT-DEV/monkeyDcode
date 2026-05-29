import { afterAll, expect, mock, test } from "bun:test"
import { Effect, Exit } from "effect"
import type { VerificationResult } from "../src/verification/types.ts"

// Capture the real pipeline module so we can restore it after this file runs
// (verification.test.ts depends on the real implementation).
import * as RealPipeline from "../src/verification/pipeline.ts"

// --- Mocks: LLM (no network) and the verification pipeline (no bun build) ---

const llmText = "export const x: number = 1"
const generate = mock(() =>
    Effect.succeed({ text: llmText, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end" }),
)
mock.module("@monkeydcode/llm", () => ({
    LLM: { generate },
    ollama: { model: (id: string) => ({ provider: "ollama", id }) },
}))

let pipelinePasses = true
function fakeResult(): VerificationResult {
    return pipelinePasses
        ? { passed: true, stage: "complete", score: 1, errors: [], durationMs: 1, stages: {} }
        : {
              passed: false,
              stage: "syntax",
              score: 0,
              errors: [{ file: "x.ts", line: 1, message: "boom", severity: "error" }],
              durationMs: 1,
              stages: {},
          }
}
const run = mock(async () => fakeResult())
mock.module("../src/verification/pipeline.ts", () => ({ ...RealPipeline, run }))

afterAll(() => {
    mock.module("../src/verification/pipeline.ts", () => RealPipeline)
})

// Import after mocks are installed.
const Sampler = await import("../src/sampler.ts")

// "claude-opus-4" is a known level-1 model → single temperature, no benchmark call.
const task = {
    prompt: "write a function",
    files: ["out.ts"],
    model: { provider: "ollama", id: "x" },
    modelId: "claude-opus-4",
}

test("extractCode strips a markdown fence", () => {
    expect(Sampler.extractCode("```ts\nconst x = 1\n```")).toBe("const x = 1")
})

test("selects a verified candidate with positive confidence", async () => {
    pipelinePasses = true
    const result = await Effect.runPromise(Sampler.sample(task))
    expect(result.selected).toBeDefined()
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.selected.verification.passed).toBe(true)
})

test("retries then fails with SamplingError when nothing verifies", async () => {
    pipelinePasses = false
    generate.mockClear()
    const exit = await Effect.runPromiseExit(Sampler.sample(task))
    expect(Exit.isFailure(exit)).toBe(true)
    // 4 attempts (initial + 3 retries) × 1 candidate at level 1.
    expect(generate.mock.calls.length).toBe(4)
})
