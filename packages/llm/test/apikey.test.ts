import { test, expect } from "bun:test"
import { LLM, anthropic, ollama } from "../src/index.ts"

test("non-ollama provider with no API key fails with auth_failed before any fetch", async () => {
    delete process.env.ANTHROPIC_API_KEY
    await expect(
        LLM.generateAsync({
            model: anthropic.model("claude-sonnet-4-6"),
            messages: [{ role: "user", content: "hi" }],
        }),
    ).rejects.toMatchObject({ code: "auth_failed" })
})

test("ollama is exempt from the API-key requirement", async () => {
    // No key is set; ollama must NOT raise auth_failed. It may fail to connect to
    // a local server, but never with an auth error.
    try {
        await LLM.generateAsync({
            model: ollama.model("qwen2.5-coder:7b"),
            messages: [{ role: "user", content: "hi" }],
        })
    } catch (e) {
        expect((e as { code?: string }).code).not.toBe("auth_failed")
    }
})
