// Tiny real MCP server for agent-side integration tests (tool-loop wiring).
// Kept local to this package rather than importing packages/mcp's test
// fixture — test suites stay independently runnable per package.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({ name: "agent-test-fixture", version: "0.0.1" })

server.registerTool(
    "echo",
    { description: "Echoes the given message back", inputSchema: { message: z.string() } },
    async ({ message }: { message: string }) => ({ content: [{ type: "text" as const, text: `echo: ${message}` }] }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
