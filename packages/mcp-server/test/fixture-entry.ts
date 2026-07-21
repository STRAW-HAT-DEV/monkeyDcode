// Spawns the real monkeydcode MCP server — the exact code path `mdc mcp-server`
// runs, exercised end-to-end (real subprocess, real stdio JSON-RPC) rather
// than calling startMcpServer() in-process.
import { startMcpServer } from "../src/index.ts"
await startMcpServer()
