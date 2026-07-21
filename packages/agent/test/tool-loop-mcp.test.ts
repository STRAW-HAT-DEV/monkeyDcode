import { test, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import { fileURLToPath } from "url"
import { join, dirname } from "path"
import { Route } from "@monkeydcode/llm/route"
import { RouteRegistry } from "@monkeydcode/llm"
import type { LLMHandler } from "@monkeydcode/llm/route"
import type { LLMResponse } from "@monkeydcode/llm/schema"
import { createManager, emptyManager, type McpManager } from "@monkeydcode/mcp"
import * as ToolLoop from "../src/tool-loop.ts"

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixture-mcp-server.ts")
const PROVIDER = "mock-toolloop-mcp"
let managers: McpManager[] = []

async function fixtureManager(): Promise<McpManager> {
    const m = await createManager({
        fixture: { type: "local", command: ["bun", FIXTURE], enabled: true, timeoutMs: 10_000 },
    })
    managers.push(m)
    return m
}

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

const model = { provider: PROVIDER, id: "mock" }

afterEach(async () => {
    await Promise.all(managers.map(m => m.close()))
    managers = []
})

test("the model can call a real MCP tool during recon and see the real result", async () => {
    const mcpManager = await fixtureManager()
    mockModel(turn => (turn === 1 ? `MCP fixture.echo {"message": "hi from the model"}` : "done, no more actions needed"))

    const result = await Effect.runPromise(
        ToolLoop.run("investigate something", { model, projectRoot: process.cwd(), maxIterations: 4, mcpManager }),
    )

    expect(result.transcript).toContain("MCP fixture.echo")
    expect(result.transcript).toContain("echo: hi from the model")
    expect(result.finalText).toBe("done, no more actions needed")
})

test("an unknown MCP tool name is rejected without ever reaching a server", async () => {
    const mcpManager = await fixtureManager()
    mockModel(turn => (turn === 1 ? `MCP fixture.no_such_tool {}` : "answer now"))

    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, mcpManager }),
    )
    expect(result.transcript).toContain("unknown MCP tool")
})

test("missing a required argument is rejected before the call, with a clear message", async () => {
    const mcpManager = await fixtureManager()
    // "echo" requires "message" — this call omits it.
    mockModel(turn => (turn === 1 ? `MCP fixture.echo {}` : "answer now"))

    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, mcpManager }),
    )
    expect(result.transcript).toContain('missing required argument "message"')
})

test("malformed JSON args are rejected with a parse error, not a crash", async () => {
    const mcpManager = await fixtureManager()
    mockModel(turn => (turn === 1 ? `MCP fixture.echo {not valid json` : "answer now"))

    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, mcpManager }),
    )
    expect(result.transcript).toContain("could not parse arguments")
})

test("with no MCP manager (nothing configured), MCP is simply absent — no crash, no menu mention", async () => {
    mockModel(() => "straight answer, no investigation")
    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4 }),
    )
    expect(result.finalText).toBe("straight answer, no investigation")
})

test("an empty manager behaves identically to no manager at all", async () => {
    mockModel(turn => (turn === 1 ? "MCP anything.anything {}" : "answer"))
    const result = await Effect.runPromise(
        ToolLoop.run("task", { model, projectRoot: process.cwd(), maxIterations: 4, mcpManager: emptyManager() }),
    )
    expect(result.transcript).toContain("no MCP servers are configured")
})
