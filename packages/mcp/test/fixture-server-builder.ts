// Dogfoods startStdioServer itself (src/server.ts) — proves the generic
// server builder, not just the raw SDK, produces a working MCP server.
import { z } from "zod"
import { startStdioServer } from "../src/server.ts"

await startStdioServer({
    name: "builder-fixture",
    version: "0.0.1",
    tools: [
        {
            name: "add",
            description: "Adds two numbers",
            inputSchema: { a: z.number(), b: z.number() },
            handler: async ({ a, b }) => ({ text: String(a + b) }),
        },
        {
            name: "boom",
            description: "Always throws",
            inputSchema: {},
            handler: async () => {
                throw new Error("boom")
            },
        },
    ],
})
