import { z } from "zod"
import { validateAssets, formatReport } from "@monkeydcode/consistency/verification/assets"
import type { McpToolDefinition } from "@monkeydcode/mcp"

export const checkAssetsTool: McpToolDefinition<{ files: z.ZodArray<z.ZodString>; projectRoot: z.ZodOptional<z.ZodString> }> = {
    name: "mdc_check_assets",
    description:
        "Validate that every image/link/stylesheet reference in the given HTML/CSS/Markdown files actually " +
        "resolves — catches broken <img src>, dead links, and missing local assets that no unit test can see.",
    inputSchema: {
        files: z.array(z.string()).describe("HTML/CSS/Markdown file paths to check, relative to projectRoot"),
        projectRoot: z.string().optional().describe("Defaults to the directory this MCP server was started in"),
    },
    handler: async ({ files, projectRoot }) => {
        const root = projectRoot ?? process.cwd()
        const results = await validateAssets(files, root)
        const broken = results.some(r => !r.ok && r.severity === "error")
        return { text: formatReport(results), isError: broken }
    },
}
