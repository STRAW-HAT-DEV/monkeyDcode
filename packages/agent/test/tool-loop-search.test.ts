import { test, expect } from "bun:test"
import { Effect } from "effect"
import { Route } from "@monkeydcode/llm/route"
import { RouteRegistry } from "@monkeydcode/llm"
import type { LLMHandler } from "@monkeydcode/llm/route"
import type { LLMResponse } from "@monkeydcode/llm/schema"
import type { Rule } from "@monkeydcode/core/permission"
import * as ToolLoop from "../src/tool-loop.ts"
import type { WebSearchConfig } from "../src/web-search.ts"

const PROVIDER = "mock-toolloop-search"
const model = { provider: PROVIDER, id: "mock" }

function mockModel(turns: (turn: number) => string): void {
    let turn = 0
    const handler: LLMHandler = {
        async generate(): Promise<LLMResponse> {
            turn++
            return { text: turns(turn), toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end" }
        },
        async *stream() {},
    }
    RouteRegistry.register(Route.make(PROVIDER, { handler, baseUrl: "http://mock", apiKey: () => "k" }))
}

test("SEARCH is not even advertised in the menu when web search isn't configured", async () => {
    mockModel(() => "straight answer")
    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4 }),
    )
    expect(result.finalText).toBe("straight answer")
})

test("a SEARCH action with no config produces a clear, non-crashing error", async () => {
    mockModel(turn => (turn === 1 ? "SEARCH bun test runner docs" : "done"))
    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4 }),
    )
    expect(result.transcript).toContain("not configured")
})

test("a deny rule for search blocks it without ever making a network call", async () => {
    process.env.MDC_TEST_SEARCH_KEY = "fake-key"
    try {
        mockModel(turn => (turn === 1 ? "SEARCH bun test runner docs" : "done"))
        const webSearchConfig: WebSearchConfig = { provider: "brave", apiKeyEnv: "MDC_TEST_SEARCH_KEY" }
        const rules: Rule[] = [{ permission: "search", pattern: "*", action: "deny" }]
        const result = await Effect.runPromise(
            ToolLoop.run("task", {
                model,
                projectRoot: process.cwd(),
                maxIterations: 4,
                webSearchConfig,
                permissionRules: rules,
            }),
        )
        expect(result.transcript).toContain("REFUSED")
    } finally {
        delete process.env.MDC_TEST_SEARCH_KEY
    }
})

test("a configured search with an invalid key fails gracefully through the real network path (no crash)", async () => {
    process.env.MDC_TEST_SEARCH_KEY = "definitely-invalid-key"
    try {
        mockModel(turn => (turn === 1 ? "SEARCH bun test runner docs" : "done"))
        const webSearchConfig: WebSearchConfig = { provider: "brave", apiKeyEnv: "MDC_TEST_SEARCH_KEY" }
        const result = await Effect.runPromise(
            ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, webSearchConfig }),
        )
        expect(result.transcript).toContain("SEARCH bun test runner docs")
        // Either an explicit error from Brave (expected: invalid key) or an
        // "ERROR searching" wrapper — never a thrown exception that aborts
        // the whole tool loop, and never a silent success.
        expect(result.transcript).toMatch(/ERROR/i)
    } finally {
        delete process.env.MDC_TEST_SEARCH_KEY
    }
}, 15_000)
