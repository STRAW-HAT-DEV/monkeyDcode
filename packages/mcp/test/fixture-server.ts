// A tiny real MCP server used only by tests, spawned as a stdio child
// process so client.ts is exercised against the actual wire protocol
// instead of a mock. Registers two tools: one that echoes input (to prove
// round-trip args/results work) and one that always errors (to prove error
// results surface as text rather than throwing past the client boundary).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({ name: "fixture", version: "0.0.1" })

server.registerTool(
    "echo",
    {
        description: "Echoes the given message back",
        inputSchema: { message: z.string() },
    },
    async ({ message }: { message: string }) => ({
        content: [{ type: "text" as const, text: `echo: ${message}` }],
    }),
)

server.registerTool(
    "always_fails",
    { description: "Always returns an error result", inputSchema: {} },
    async () => ({
        isError: true,
        content: [{ type: "text" as const, text: "deliberate failure" }],
    }),
)

const transport = new StdioServerTransport()
await server.connect(transport)
