import { startStdioServer } from "@monkeydcode/mcp"
import { buildTool } from "./tools/build.ts"
import { verifyTool } from "./tools/verify.ts"
import { checkAssetsTool } from "./tools/check-assets.ts"

export const VERSION = "0.1.0"

/** Start monkeyDcode as an MCP server on stdio, exposing mdc_build,
 *  mdc_verify, and mdc_check_assets to any MCP client (Claude Desktop, other
 *  agents, …). Resolves once connected; the process then blocks serving
 *  requests until its stdin pipe closes (the caller's responsibility). */
export function startMcpServer(): Promise<void> {
    return startStdioServer({
        name: "monkeydcode",
        version: VERSION,
        tools: [buildTool, verifyTool, checkAssetsTool],
    })
}
