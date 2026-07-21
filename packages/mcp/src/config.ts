// MCP server configuration — the closed menu of servers the agent may ever
// reach. Deliberately config-only: model text can never introduce a new
// server (see manager.ts). Shape mirrors the local/remote split used
// elsewhere in this codebase's opencode-derived engine config, minus OAuth —
// interactive browser-based auth doesn't fit a scriptable, non-interactive
// agent; a static bearer token via `headers` covers the common PAT case.

export interface McpLocalServerConfig {
    type: "local"
    /** argv[0] is the command, the rest are its arguments. */
    command: string[]
    /** Extra environment variables merged over the current process env. */
    env?: Record<string, string>
    enabled: boolean
    timeoutMs: number
}

export interface McpRemoteServerConfig {
    type: "remote"
    url: string
    /** Static headers (e.g. `{ Authorization: "Bearer ${TOKEN}" }`) — no OAuth flow. */
    headers?: Record<string, string>
    enabled: boolean
    timeoutMs: number
}

export type McpServerConfig = McpLocalServerConfig | McpRemoteServerConfig

export const DEFAULT_MCP_TIMEOUT_MS = 20_000

export function isMcpServerConfig(value: unknown): value is McpServerConfig {
    if (typeof value !== "object" || value === null) return false
    const v = value as Record<string, unknown>
    if (v.type === "local") return Array.isArray(v.command) && v.command.every(c => typeof c === "string")
    if (v.type === "remote") return typeof v.url === "string"
    return false
}
