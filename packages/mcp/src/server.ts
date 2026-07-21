// Generic MCP server builder — protocol plumbing only, no monkeyDcode-specific
// tool logic (that lives in @monkeydcode/mcp-server, which depends on THIS
// module the same way any MCP tool provider would). Mirrors client.ts's
// stance: a thin, typed wrapper over the raw SDK, not a reimplementation of it.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z, type ZodRawShape } from "zod"

export interface McpToolResult {
    text: string
    isError?: boolean
}

export interface McpToolDefinition<Args extends ZodRawShape = ZodRawShape> {
    name: string
    description: string
    inputSchema: Args
    handler: (args: z.infer<z.ZodObject<Args>>) => Promise<McpToolResult>
}

export interface McpServerInfo {
    name: string
    version: string
    // Each tool is fully typed at its OWN definition site (`McpToolDefinition<MySpecificShape>`
    // — see mcp-server's tools/*.ts). Storing a heterogeneous list of them is the one place
    // that needs the schema erased: a handler requiring `{task: string}` isn't substitutable
    // for one accepting `Record<string, unknown>` (function parameters are contravariant),
    // so the collection type has to widen here. startStdioServer itself never reads a
    // specific field by name — it only forwards whatever the SDK already validated against
    // each tool's own inputSchema — so this erasure costs no real type safety.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tools: McpToolDefinition<any>[]
}

/**
 * Build and connect a stdio MCP server exposing `tools`.
 *
 * The SDK's `server.connect(transport)` resolves as soon as the transport
 * STARTS (`transport.start()`) — message handling after that happens purely
 * through event listeners the SDK attaches to the transport, completely
 * decoupled from that promise. It does NOT wait for the session to end.
 * A caller that does `await startStdioServer(...)` expecting this function
 * to block for the server's whole lifetime — the entire point of "start a
 * server" — would have code after it start running immediately, while the
 * transport is still very much live on stdin/stdout. If that code then
 * writes anything to stdout (a banner, a prompt, a console.log), it
 * corrupts the JSON-RPC stream stdout now *is*, and every subsequent
 * request appears to hang or the client sees framing errors. (Caught via a
 * real subprocess test that called `mdc mcp-server` through the actual CLI
 * entry point — not something an in-process check would ever surface.)
 * So this function has an explicit resolve-on-close contract: it hangs the
 * process here, correctly, until the transport actually closes.
 */
export async function startStdioServer(info: McpServerInfo): Promise<void> {
    const server = new McpServer({ name: info.name, version: info.version })

    for (const tool of info.tools) {
        server.registerTool(
            tool.name,
            { description: tool.description, inputSchema: tool.inputSchema },
            async (args: unknown) => {
                try {
                    const result = await tool.handler(args as never)
                    return { content: [{ type: "text" as const, text: result.text }], isError: result.isError }
                } catch (e) {
                    return {
                        content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
                        isError: true,
                    }
                }
            },
        )
    }

    const transport = new StdioServerTransport()
    const closed = new Promise<void>((resolve, reject) => {
        transport.onclose = () => resolve()
        transport.onerror = err => reject(err)
    })
    await server.connect(transport)
    await closed
}
