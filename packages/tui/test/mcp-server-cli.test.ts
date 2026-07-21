import { test, expect } from "bun:test"
import { fileURLToPath } from "url"
import { join, dirname } from "path"
import { connect } from "@monkeydcode/mcp/client"

// Regression test for a real bug: `mdc mcp-server` (this package's CLI entry)
// used to call process.exit(0) right after the MCP handshake resolved — which
// happens the instant the transport STARTS, not when the session ends (see
// packages/mcp/src/server.ts's startStdioServer for the full explanation).
// Removing that exit() without also making startMcpServer() block until the
// transport actually closes let execution fall through to the rest of
// index.tsx, which prints the interactive banner/prompt to stdout — the exact
// stream the MCP JSON-RPC protocol was using — corrupting every message after
// the handshake. Every earlier test exercised startMcpServer() or a hand-built
// fixture directly, never the real `bin/mdc mcp-server` process, so none of
// them could have caught this. This one spawns the actual CLI entry point.
const BIN_MDC = join(dirname(fileURLToPath(import.meta.url)), "../../../bin/mdc")

test("`mdc mcp-server` — the real CLI entry point — serves real MCP requests, not just the handshake", async () => {
    const { connection, error } = await connect("mdc-cli", {
        type: "local",
        command: ["bun", BIN_MDC, "mcp-server"],
        enabled: true,
        timeoutMs: 15_000,
    })
    expect(error).toBeUndefined()
    expect(connection).toBeDefined()

    // The regression: tools/list (issued right after connect) used to hang/
    // fail because the banner had already corrupted the stream by the time
    // this request's response came back.
    expect(connection!.tools.map(t => t.name).sort()).toEqual(["mdc_build", "mdc_check_assets", "mdc_verify"])

    const text = await connection!.callTool("mdc_check_assets", { files: [], projectRoot: process.cwd() }, 10_000)
    expect(text).toBe("No asset references found.") // formatReport([]) — see verification/assets.ts

    await connection!.close()
}, 20_000)
