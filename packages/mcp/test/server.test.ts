import { test, expect } from "bun:test"
import { fileURLToPath } from "url"
import { join, dirname } from "path"
import { connect } from "../src/client.ts"

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixture-server-builder.ts")

function config() {
    return { type: "local" as const, command: ["bun", FIXTURE], enabled: true, timeoutMs: 10_000 }
}

test("startStdioServer produces a real server a real client can call", async () => {
    const { connection } = await connect("builder-fixture", config())
    expect(connection).toBeDefined()
    expect(connection!.tools.map(t => t.name).sort()).toEqual(["add", "boom"])

    const text = await connection!.callTool("add", { a: 2, b: 3 }, 5_000)
    expect(text).toBe("5")
    await connection!.close()
})

test("a handler that throws is surfaced as an MCP error result, not a crashed server", async () => {
    const { connection } = await connect("builder-fixture", config())
    const text = await connection!.callTool("boom", {}, 5_000)
    expect(text).toContain("ERROR")
    expect(text).toContain("boom")
    await connection!.close()
})
