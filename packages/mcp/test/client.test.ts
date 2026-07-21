import { test, expect } from "bun:test"
import { fileURLToPath } from "url"
import { join, dirname } from "path"
import { connect } from "../src/client.ts"
import { createManager, emptyManager } from "../src/manager.ts"
import type { McpServerConfig } from "../src/config.ts"

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixture-server.ts")

function fixtureConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
    return { type: "local", command: ["bun", FIXTURE], enabled: true, timeoutMs: 10_000, ...overrides } as McpServerConfig
}

test("connects to a real stdio MCP server and lists its tools", async () => {
    const result = await connect("fixture", fixtureConfig())
    expect(result.error).toBeUndefined()
    expect(result.connection).toBeDefined()
    const names = result.connection!.tools.map(t => t.name).sort()
    expect(names).toEqual(["always_fails", "echo"])
    await result.connection!.close()
})

test("calls a real tool and gets the actual result back over the wire", async () => {
    const { connection } = await connect("fixture", fixtureConfig())
    const text = await connection!.callTool("echo", { message: "hello mcp" }, 10_000)
    expect(text).toBe("echo: hello mcp")
    await connection!.close()
})

test("a tool-level error result is surfaced as text, not thrown", async () => {
    const { connection } = await connect("fixture", fixtureConfig())
    const text = await connection!.callTool("always_fails", {}, 10_000)
    expect(text).toContain("ERROR")
    expect(text).toContain("deliberate failure")
    await connection!.close()
})

test("connect() never throws for a bad command — reports an error instead", async () => {
    const result = await connect("bad", fixtureConfig({ command: ["this-binary-does-not-exist-xyz"] }))
    expect(result.connection).toBeUndefined()
    expect(result.error).toBeDefined()
})

test("connect() reports 'disabled' for a disabled server without spawning anything", async () => {
    const result = await connect("off", fixtureConfig({ enabled: false }))
    expect(result.error).toBe("disabled")
    expect(result.connection).toBeUndefined()
})

// ─── manager.ts: multi-server orchestration ─────────────────────────────────

test("createManager connects to multiple servers concurrently and exposes qualified tool names", async () => {
    const manager = await createManager({
        a: fixtureConfig(),
        b: fixtureConfig(),
    })
    const names = manager.tools.map(t => t.qualifiedName).sort()
    expect(names).toEqual(["a.always_fails", "a.echo", "b.always_fails", "b.echo"])
    expect(manager.status().a).toEqual({ status: "connected", toolCount: 2 })
    await manager.close()
})

test("one broken server does not prevent other servers from connecting", async () => {
    const manager = await createManager({
        good: fixtureConfig(),
        bad: fixtureConfig({ command: ["this-binary-does-not-exist-xyz"] }),
    })
    expect(manager.status().good).toEqual({ status: "connected", toolCount: 2 })
    expect(manager.status().bad?.status).toBe("failed")
    expect(manager.tools.map(t => t.server)).toEqual(["good", "good"])
    await manager.close()
})

test("manager.callTool routes to the right server and validates the tool exists first", async () => {
    const manager = await createManager({ srv: fixtureConfig() })
    const text = await manager.callTool("srv", "echo", { message: "routed" })
    expect(text).toBe("echo: routed")
    await expect(manager.callTool("srv", "no_such_tool", {})).rejects.toThrow(/no tool/)
    await expect(manager.callTool("nope", "echo", {})).rejects.toThrow(/not connected/)
    await manager.close()
})

test("emptyManager never requires a null check at call sites", async () => {
    const manager = emptyManager()
    expect(manager.tools).toEqual([])
    await expect(manager.callTool("x", "y", {})).rejects.toThrow()
    await manager.close() // must not throw
})
