import { test, expect, beforeEach } from "bun:test"
import { mkdtemp, readFile, writeFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { client as createClientApp, AGENT_METHODS, CLIENT_METHODS, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { Route } from "@monkeydcode/llm/route"
import { RouteRegistry } from "@monkeydcode/llm"
import type { LLMHandler } from "@monkeydcode/llm/route"
import type { LLMResponse } from "@monkeydcode/llm/schema"
import { buildAgentApp, _resetSessionsForTest } from "../src/agent.ts"

// Real, in-process ACP protocol conversation — no stdio, no subprocess.
// AgentApp/ClientApp support connecting directly to each other specifically
// for this: real JSON-RPC method dispatch and param validation, without a
// transport. A mock LLM route stands in for the model (same technique used
// throughout this session's other test suites).

const PROVIDER = "mock-acp-agent"

function mockModel(reply: string): void {
    const handler: LLMHandler = {
        async generate(): Promise<LLMResponse> {
            return { text: reply, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end" }
        },
        async *stream() {},
    }
    RouteRegistry.register(Route.make(PROVIDER, { handler, baseUrl: "http://mock", apiKey: () => "k" }))
}

beforeEach(() => {
    _resetSessionsForTest()
})

/**
 * handlePrompt() chdir's into the session's own cwd for the duration of
 * Orchestrator.handle — so, unlike some of this session's other tests, a
 * genuinely isolated `cwd` here (not the real monorepo root) is enough on
 * its own for MOST repo-relative state. The one exception is
 * working-memory.ts, which resolves its file path from process.cwd() ONCE
 * at module-import time, not per-call — if anything already imported it
 * pointing at the monorepo root, it stays frozen there regardless of this
 * test's chdir. Snapshotting/restoring the real file is the belt-and-braces
 * fix already used elsewhere this session (mcp-server, orchestrator tests).
 */
async function withIsolatedSession<T>(run: (cwd: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "mdc-acp-session-"))
    const memoryFile = join(process.cwd(), ".monkeydcode", "working-memory.json")
    const memoryBefore = await readFile(memoryFile, "utf-8").catch(() => null)
    try {
        return await run(dir)
    } finally {
        if (memoryBefore === null) await rm(memoryFile, { force: true })
        else await writeFile(memoryFile, memoryBefore, "utf-8")
        await rm(dir, { recursive: true, force: true })
    }
}

test("initialize returns the negotiated protocol version and no-auth capabilities", async () => {
    const agentApp = buildAgentApp()
    const clientApp = createClientApp()

    await clientApp.connectWith(agentApp, async ctx => {
        const response = await ctx.request(AGENT_METHODS.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            clientCapabilities: {},
        })
        expect(response.protocolVersion).toBe(PROTOCOL_VERSION)
        expect(response.authMethods).toEqual([])
        expect(response.agentCapabilities?.loadSession).toBe(false)
    })
})

test("session/new returns a session id that session/prompt can then use", async () => {
    await withIsolatedSession(async cwd => {
        const agentApp = buildAgentApp()
        const clientApp = createClientApp()

        await clientApp.connectWith(agentApp, async ctx => {
            const response = await ctx.request(AGENT_METHODS.session_new, { cwd, mcpServers: [] })
            expect(typeof response.sessionId).toBe("string")
            expect(response.sessionId.length).toBeGreaterThan(0)
        })
    })
})

test("a real prompt turn: text goes in, the orchestrator's real reply comes back via session/update, stopReason is end_turn", async () => {
    await withIsolatedSession(async cwd => {
        mockModel("mocked orchestrator reply for ACP")
        const agentApp = buildAgentApp()
        const clientApp = createClientApp()
        const updates: SessionNotification[] = []

        await clientApp
            .onNotification(CLIENT_METHODS.session_update, ctx => {
                updates.push(ctx.params)
            })
            .connectWith(agentApp, async ctx => {
                const { sessionId } = await ctx.request(AGENT_METHODS.session_new, { cwd, mcpServers: [] })
                const result = await ctx.request(AGENT_METHODS.session_prompt, {
                    sessionId,
                    prompt: [{ type: "text", text: "say hello" }],
                })
                expect(result.stopReason).toBe("end_turn")
            })

        expect(updates).toHaveLength(1)
        expect(updates[0]!.update.sessionUpdate).toBe("agent_message_chunk")
    })
}, 30_000) // first call may pay the python-bridge/knowledge-graph init cost

test("session/prompt for an unknown session id fails cleanly instead of crashing the connection", async () => {
    const agentApp = buildAgentApp()
    const clientApp = createClientApp()

    await clientApp.connectWith(agentApp, async ctx => {
        await expect(
            ctx.request(AGENT_METHODS.session_prompt, {
                sessionId: "this-session-does-not-exist",
                prompt: [{ type: "text", text: "hi" }],
            }),
        ).rejects.toThrow()
    })
})

test("session/cancel marks the session so a subsequent prompt reports cancelled", async () => {
    await withIsolatedSession(async cwd => {
        mockModel("reply that should be discarded")
        const agentApp = buildAgentApp()
        const clientApp = createClientApp()

        await clientApp
            .onNotification(CLIENT_METHODS.session_update, () => {})
            .connectWith(agentApp, async ctx => {
                const { sessionId } = await ctx.request(AGENT_METHODS.session_new, { cwd, mcpServers: [] })
                await ctx.notify(AGENT_METHODS.session_cancel, { sessionId })
                const result = await ctx.request(AGENT_METHODS.session_prompt, {
                    sessionId,
                    prompt: [{ type: "text", text: "say hello" }],
                })
                expect(result.stopReason).toBe("cancelled")
            })
    })
}, 30_000)
