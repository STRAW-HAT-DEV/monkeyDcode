import { z } from "zod"
import * as Pipeline from "@monkeydcode/consistency/verification/pipeline"
import type { McpToolDefinition } from "@monkeydcode/mcp"

// Unlike mdc_build, Pipeline.run already takes projectRoot as an explicit,
// properly-threaded parameter (no hidden process.cwd() reliance) — so this
// tool can safely accept a caller-supplied root with no global-state risk.
export const verifyTool: McpToolDefinition<{ files: z.ZodArray<z.ZodString>; projectRoot: z.ZodOptional<z.ZodString> }> = {
    name: "mdc_verify",
    description:
        "Run monkeyDcode's verification pipeline (syntax, typecheck, lint, tests, assets, smoke — whichever apply) " +
        "against a set of files and report pass/fail with the specific errors.",
    inputSchema: {
        files: z.array(z.string()).describe("File paths to verify, relative to projectRoot"),
        projectRoot: z.string().optional().describe("Defaults to the directory this MCP server was started in"),
    },
    handler: async ({ files, projectRoot }) => {
        const root = projectRoot ?? process.cwd()
        const result = await Pipeline.run(files, root)
        const summary = result.passed
            ? `PASSED (score ${(result.score * 100).toFixed(0)}%)`
            : Pipeline.formatErrors(result)
        return { text: summary, isError: !result.passed }
    },
}
