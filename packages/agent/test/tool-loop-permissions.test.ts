import { test, expect } from "bun:test"
import { Effect } from "effect"
import { fileURLToPath } from "url"
import { join, dirname } from "path"
import { Route } from "@monkeydcode/llm/route"
import { RouteRegistry } from "@monkeydcode/llm"
import type { LLMHandler } from "@monkeydcode/llm/route"
import type { LLMResponse } from "@monkeydcode/llm/schema"
import { createManager, type McpManager } from "@monkeydcode/mcp"
import type { Rule } from "@monkeydcode/core/permission"
import * as ToolLoop from "../src/tool-loop.ts"

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixture-mcp-server.ts")
const PROVIDER = "mock-toolloop-permissions"
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

async function fixtureManager(): Promise<McpManager> {
    return createManager({ fixture: { type: "local", command: ["bun", FIXTURE], enabled: true, timeoutMs: 10_000 } })
}

test("with no permission rules configured, RUN commands behave exactly as before (unchanged default)", async () => {
    mockModel(turn => (turn === 1 ? "RUN git-status" : "done"))
    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4 }),
    )
    expect(result.transcript).not.toContain("REFUSED")
})

test("a deny rule for a specific RUN command refuses it, with a clear reason", async () => {
    mockModel(turn => (turn === 1 ? "RUN test" : "done"))
    const rules: Rule[] = [{ permission: "run", pattern: "test", action: "deny" }]
    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, permissionRules: rules }),
    )
    expect(result.transcript).toContain("REFUSED")
    expect(result.transcript).toContain("run:test")
})

test("a deny rule for one RUN command does not affect a different, unrelated command", async () => {
    mockModel(turn => (turn === 1 ? "RUN git-status" : "done"))
    const rules: Rule[] = [{ permission: "run", pattern: "test", action: "deny" }]
    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, permissionRules: rules }),
    )
    expect(result.transcript).not.toContain("REFUSED")
})

test("a request that matches no configured rule stays allowed — true default-allow, not an implicit denylist", async () => {
    mockModel(turn => (turn === 1 ? "RUN git-diff" : "done"))
    // Only "test" has a rule — "git-diff" is unmatched and must be unaffected.
    const rules: Rule[] = [{ permission: "run", pattern: "test", action: "deny" }]
    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, permissionRules: rules }),
    )
    expect(result.transcript).not.toContain("REFUSED")
})

test("an explicit wildcard rule can still be used to deny everything, if the user wants an allowlist model", async () => {
    mockModel(turn => (turn === 1 ? "RUN git-diff" : "done"))
    const rules: Rule[] = [{ permission: "run", pattern: "*", action: "deny" }]
    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, permissionRules: rules }),
    )
    expect(result.transcript).toContain("REFUSED")
})

test("a wildcard deny rule blocks every RUN command", async () => {
    mockModel(turn => (turn === 1 ? "RUN typecheck" : "done"))
    const rules: Rule[] = [{ permission: "run", pattern: "*", action: "deny" }]
    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, permissionRules: rules }),
    )
    expect(result.transcript).toContain("REFUSED")
})

test("a deny rule for a specific MCP tool blocks that call without touching the real server", async () => {
    const mcpManager = await fixtureManager()
    try {
        mockModel(turn => (turn === 1 ? `MCP fixture.echo {"message": "hi"}` : "done"))
        const rules: Rule[] = [{ permission: "mcp", pattern: "fixture.echo", action: "deny" }]
        const result = await Effect.runPromise(
            ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, mcpManager, permissionRules: rules }),
        )
        expect(result.transcript).toContain("REFUSED")
        expect(result.transcript).not.toContain("echo: hi") // never actually called
    } finally {
        await mcpManager.close()
    }
})

test("an allow-listed MCP tool still works normally with rules configured", async () => {
    const mcpManager = await fixtureManager()
    try {
        mockModel(turn => (turn === 1 ? `MCP fixture.echo {"message": "hi"}` : "done"))
        const rules: Rule[] = [{ permission: "mcp", pattern: "fixture.echo", action: "allow" }]
        const result = await Effect.runPromise(
            ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, mcpManager, permissionRules: rules }),
        )
        expect(result.transcript).toContain("echo: hi")
    } finally {
        await mcpManager.close()
    }
})
