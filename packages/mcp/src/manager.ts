// Owns every configured MCP server connection for one agent session.
//
// Single responsibility: turn a config map into live connections and offer a
// flat, name-qualified tool surface. It does NOT know about the tool-loop's
// action grammar or the orchestrator — those are consumers (dependency
// inversion: they depend on this module's small interface, not on
// @modelcontextprotocol/sdk directly).

import { connect, type McpConnection, type McpToolSummary } from "./client.ts"
import type { McpServerConfig } from "./config.ts"

export interface QualifiedTool extends McpToolSummary {
    server: string
    /** "<server>.<tool>" — what the model addresses it as. */
    qualifiedName: string
}

export type McpServerStatus =
    | { status: "connected"; toolCount: number }
    | { status: "disabled" }
    | { status: "failed"; error: string }

export interface McpManager {
    readonly tools: QualifiedTool[]
    status(): Record<string, McpServerStatus>
    callTool(server: string, tool: string, args: Record<string, unknown>, timeoutMs?: number): Promise<string>
    close(): Promise<void>
}

const DEFAULT_CALL_TIMEOUT_MS = 20_000

/** Connect to every configured server concurrently. One server's failure
 *  never blocks or aborts another's — resilience matches the rest of this
 *  codebase's "degrade, don't crash" posture (e.g. python-bridge, screenshot). */
export async function createManager(servers: Record<string, McpServerConfig>): Promise<McpManager> {
    const entries = Object.entries(servers)
    const results = await Promise.all(
        entries.map(async ([name, config]) => ({ name, config, result: await connect(name, config) })),
    )

    const connections = new Map<string, McpConnection>()
    const status: Record<string, McpServerStatus> = {}
    const tools: QualifiedTool[] = []

    for (const { name, config, result } of results) {
        if (result.connection) {
            connections.set(name, result.connection)
            status[name] = { status: "connected", toolCount: result.connection.tools.length }
            for (const t of result.connection.tools) {
                tools.push({ ...t, server: name, qualifiedName: `${name}.${t.name}` })
            }
        } else if (result.error === "disabled" || !config.enabled) {
            status[name] = { status: "disabled" }
        } else {
            status[name] = { status: "failed", error: result.error ?? "unknown error" }
        }
    }

    return {
        tools,
        status: () => status,
        async callTool(server, tool, args, timeoutMs = DEFAULT_CALL_TIMEOUT_MS) {
            const connection = connections.get(server)
            if (!connection) throw new Error(`MCP server "${server}" is not connected`)
            if (!connection.tools.some(t => t.name === tool)) {
                throw new Error(`MCP server "${server}" has no tool "${tool}"`)
            }
            return connection.callTool(tool, args, timeoutMs)
        },
        async close() {
            await Promise.all([...connections.values()].map(c => c.close()))
        },
    }
}

/** A manager with zero servers — used when MCP isn't configured, so callers
 *  never need an `if (manager)` branch. */
export function emptyManager(): McpManager {
    return {
        tools: [],
        status: () => ({}),
        async callTool(server) {
            throw new Error(`MCP server "${server}" is not connected`)
        },
        async close() {},
    }
}
