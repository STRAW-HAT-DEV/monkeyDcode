import { test, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import { LLM } from "../src/llm.ts"
import { Route } from "../src/route.ts"
import { RouteRegistry } from "../src/route-registry.ts"
import { LLMError } from "../src/error.ts"
import type { LLMHandler } from "../src/handler.ts"
import type { LLMRequest, LLMResponse } from "../src/schema.ts"

// Keep the suite fast: no real backoff waits. The server-suggested delay parsed
// from "try again in 0.01s" dominates the exponential fallback.
process.env["MDCODE_LLM_MAX_RETRIES"] = "4"

const req = (provider: string): LLMRequest => ({
    model: { provider, id: "mock-model" },
    messages: [{ role: "user", content: "hi" }],
})

const okResponse: LLMResponse = { text: "ok", toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end" }

/** A Groq-style 429: plain APIError shape (status + code), not an LLMError. */
function groq429(): Error {
    const e = new Error(
        "Rate limit reached for model `llama-3.3-70b-versatile` ... Please try again in 0.01s",
    ) as Error & { status: number; code: string }
    e.status = 429
    e.code = "rate_limit_exceeded"
    return e
}

function makeHandler(behavior: () => Promise<LLMResponse>): LLMHandler {
    return {
        generate: behavior,
        async *stream() { /* unused */ },
    }
}

const registered: string[] = []
function register(provider: string, handler: LLMHandler): void {
    RouteRegistry.register(
        Route.make(provider, { handler, baseUrl: "http://mock", apiKey: () => "k" }),
    )
    registered.push(provider)
}

afterEach(() => {
    // best-effort isolation between tests
    registered.length = 0
})

test("SDK-handler path retries a transient 429 and then succeeds", async () => {
    let calls = 0
    register("mock-retry", makeHandler(async () => {
        calls++
        if (calls <= 2) throw groq429()
        return okResponse
    }))

    const res = await LLM.generateAsync(req("mock-retry"))
    expect(res.text).toBe("ok")
    expect(calls).toBe(3) // failed twice, succeeded on the third
})

test("SDK-handler path (Effect API) also retries a 429", async () => {
    let calls = 0
    register("mock-retry-effect", makeHandler(async () => {
        calls++
        if (calls <= 1) throw groq429()
        return okResponse
    }))

    const res = await Effect.runPromise(LLM.generate(req("mock-retry-effect")))
    expect(res.text).toBe("ok")
    expect(calls).toBe(2)
})

test("a non-transient error (400) is NOT retried", async () => {
    let calls = 0
    register("mock-noretry", makeHandler(async () => {
        calls++
        const e = new Error("invalid request") as Error & { status: number }
        e.status = 400
        throw e
    }))

    await expect(LLM.generateAsync(req("mock-noretry"))).rejects.toBeInstanceOf(LLMError)
    expect(calls).toBe(1) // thrown immediately, no retry
})

test("retries are bounded — a persistent 429 eventually gives up", async () => {
    let calls = 0
    register("mock-always-429", makeHandler(async () => {
        calls++
        throw groq429()
    }))

    await expect(LLM.generateAsync(req("mock-always-429"))).rejects.toBeInstanceOf(LLMError)
    expect(calls).toBe(5) // initial try + 4 retries
})
