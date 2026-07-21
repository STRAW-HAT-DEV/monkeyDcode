// Session-scoped MCP connection cache.
//
// Connecting a stdio MCP server spawns a real subprocess — expensive enough
// that it must happen once per agent session, not once per tool-loop
// investigation. This module is the single place that owns that lifecycle:
// callers (tool-loop consumers) ask for the manager and get the same live
// connections back every time, exactly like orchestrator.ts's
// `contextInitialized` pattern for the retriever's session context.
//
// If nothing is configured, or every configured server fails to connect,
// callers still get a valid `McpManager` with zero tools — no null checks
// need to leak into build-agent.ts or the tool loop.

import { loadConfig } from "@monkeydcode/core/mdc-config"
import { createManager, emptyManager, type McpManager } from "@monkeydcode/mcp"

let cached: Promise<McpManager> | null = null

/** Connect (once) to every MCP server configured in mdc-config.toml and
 *  cache the result for the rest of the process lifetime. */
export function getMcpManager(): Promise<McpManager> {
    if (!cached) {
        cached = loadConfig()
            .then(config => createManager(config.mcp.servers))
            .catch(() => emptyManager())
    }
    return cached
}

/** Close all connections and drop the cache — used by tests and by a clean
 *  process shutdown; not required for correctness during normal operation
 *  since the CLI process exit already reclaims the child processes. */
export async function closeMcpManager(): Promise<void> {
    if (!cached) return
    const manager = await cached
    cached = null
    await manager.close()
}
