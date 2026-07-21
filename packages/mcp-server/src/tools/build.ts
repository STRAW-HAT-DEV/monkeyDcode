import { Effect, Cause } from "effect"
import { z } from "zod"
import * as Orchestrator from "@monkeydcode/agent/orchestrator"
import type { McpToolDefinition } from "@monkeydcode/mcp"
import { resolveConfiguredModel } from "../model.ts"
import { describeError } from "../error.ts"

// Deliberately runs on the directory this MCP server process was started in
// (process.cwd()), NOT an arbitrary projectRoot argument. Orchestrator.handle
// and everything beneath it (build-agent, sampler, hashline patch targets)
// reads process.cwd() directly at many call sites rather than threading a
// root parameter through; retargeting it per-call would mean process.chdir()
// on every invocation, which is process-global and unsafe if two mdc_build
// calls ever overlap on the same server connection. One server process =
// one project, exactly like running `mdc "task"` from that directory.
export const buildTool: McpToolDefinition<{ task: z.ZodString }> = {
    name: "mdc_build",
    description:
        "Run monkeyDcode's full agent (classify, plan, build, verify) on a task, in the directory this MCP " +
        "server was started in. Equivalent to running `mdc \"<task>\"` from that directory.",
    inputSchema: { task: z.string().describe("The task to perform, in natural language") },
    handler: async ({ task }) => {
        const { model, modelId } = await resolveConfiguredModel()
        const exit = await Effect.runPromiseExit(Orchestrator.handle(task, model, modelId, []))
        if (exit._tag === "Success") return { text: exit.value }
        return { text: describeError(Cause.squash(exit.cause)), isError: true }
    },
}
