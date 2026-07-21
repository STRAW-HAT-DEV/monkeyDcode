// A single MCP server connection. Deliberately plain Promise-based — no
// Effect Service/Bus/Config layer — so it can be used from packages/agent's
// lightweight Effect.gen call sites the same way LLM.generateAsync already
// is (Effect.tryPromise at the boundary), without pulling the orchestrator
// into the engine's full opencode-derived runtime.

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Tool as McpToolDef } from "@modelcontextprotocol/sdk/types.js"
import { buildSandboxedCommand } from "@monkeydcode/core/util/sandbox"
import type { McpServerConfig } from "./config.ts"

export interface McpToolSummary {
    name: string
    description: string
    /** Raw JSON Schema for the tool's input — used for shallow arg validation
     *  before a call ever reaches the server process. */
    inputSchema: McpToolDef["inputSchema"]
}

export interface McpConnection {
    readonly serverName: string
    readonly tools: McpToolSummary[]
    callTool(toolName: string, args: Record<string, unknown>, timeoutMs: number): Promise<string>
    close(): Promise<void>
}

export interface McpConnectResult {
    connection?: McpConnection
    error?: string
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
    ])
}

/** A locally-configured MCP server is genuinely untrusted, user-installed
 *  third-party code — the highest-value sandboxing target in this codebase
 *  (see packages/core/util/sandbox.ts). It gets the FULL treatment: an
 *  allowlisted environment (config.env is the explicit opt-in, not the
 *  parent process's full env — e.g. this project's own LLM provider API
 *  keys never reach a filesystem MCP server) plus bwrap/sandbox-exec
 *  wrapping when available. Network stays allowed by default — unlike the
 *  tool loop's read-only RUN diagnostics, most useful real-world MCP
 *  servers (GitHub, web search, remote databases) need it. */
function buildTransport(config: McpServerConfig) {
    if (config.type === "local") {
        const [command, ...args] = config.command
        if (!command) throw new Error("local MCP server config has an empty command")
        const sandboxed = buildSandboxedCommand([command, ...args], {
            cwd: process.cwd(),
            allowNetwork: true,
            extraEnv: config.env,
        })
        const [sandboxedCommand, ...sandboxedArgs] = sandboxed.command
        return new StdioClientTransport({
            command: sandboxedCommand!,
            args: sandboxedArgs,
            env: sandboxed.env,
            cwd: process.cwd(),
            stderr: "pipe",
        })
    }
    const url = new URL(config.url)
    return new StreamableHTTPClientTransport(url, {
        requestInit: config.headers ? { headers: config.headers } : undefined,
    })
}

/** Extracts the text content of an MCP tool result into a single string —
 *  the tool-loop only needs text observations, not the full multi-part
 *  content protocol (images/resources are summarized, not embedded). */
function renderResult(result: Awaited<ReturnType<Client["callTool"]>>): string {
    if (!Array.isArray(result.content)) return JSON.stringify(result)
    const parts = result.content.map(part => {
        if (part.type === "text") return part.text
        if (part.type === "image") return `[image: ${part.mimeType ?? "unknown"}, omitted]`
        if (part.type === "resource") return `[resource: ${JSON.stringify(part.resource).slice(0, 200)}]`
        return `[${part.type}]`
    })
    const text = parts.join("\n")
    return result.isError ? `ERROR: ${text}` : text
}

/** Connect to one server and list its tools. Never throws — failures are
 *  reported in the result so a single misconfigured server can't abort
 *  startup for every other configured server (see manager.ts). */
export async function connect(serverName: string, config: McpServerConfig): Promise<McpConnectResult> {
    if (!config.enabled) return { error: "disabled" }

    let transport: StdioClientTransport | StreamableHTTPClientTransport
    try {
        transport = buildTransport(config)
    } catch (e) {
        return { error: `invalid config: ${e instanceof Error ? e.message : String(e)}` }
    }

    const client = new Client({ name: "monkeydcode", version: "0.1.0" })

    try {
        await withTimeout(client.connect(transport), config.timeoutMs, `connect to "${serverName}"`)
    } catch (e) {
        await transport.close().catch(() => undefined)
        return { error: e instanceof Error ? e.message : String(e) }
    }

    let listed: { tools: McpToolDef[] }
    try {
        listed = await withTimeout(client.listTools(), config.timeoutMs, `list tools on "${serverName}"`)
    } catch (e) {
        await client.close().catch(() => undefined)
        return { error: `connected but failed to list tools: ${e instanceof Error ? e.message : String(e)}` }
    }

    const tools: McpToolSummary[] = listed.tools.map(t => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema,
    }))

    const connection: McpConnection = {
        serverName,
        tools,
        async callTool(toolName, args, timeoutMs) {
            const result = await withTimeout(
                client.callTool({ name: toolName, arguments: args }),
                timeoutMs,
                `call ${serverName}.${toolName}`,
            )
            return renderResult(result)
        },
        async close() {
            await client.close().catch(() => undefined)
        },
    }

    return { connection }
}
