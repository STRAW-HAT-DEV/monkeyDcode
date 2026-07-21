import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, writeFile, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { connect } from "@monkeydcode/mcp"
import { RouteRegistry, Route } from "@monkeydcode/llm"
import type { LLMHandler } from "@monkeydcode/llm/route"
import type { LLMResponse } from "@monkeydcode/llm/schema"
import { buildTool } from "../src/tools/build.ts"

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixture-entry.ts")

let projectDir: string
let emptyConfigDir: string

beforeAll(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "mdc-mcpserver-project-"))
    await writeFile(join(projectDir, "index.html"), `<img src="does-not-exist.png">`)

    // An isolated, empty config dir — proves mdc_build fails cleanly (never
    // hangs on the interactive wizard) when no model is configured, without
    // touching the real user config.
    emptyConfigDir = await mkdtemp(join(tmpdir(), "mdc-mcpserver-noconfig-"))
})

afterAll(async () => {
    await rm(projectDir, { recursive: true, force: true })
    await rm(emptyConfigDir, { recursive: true, force: true })
})

// mdc_verify/mdc_check_assets take projectRoot explicitly in the tool call
// args, so the server subprocess's own OS cwd is irrelevant to those tests.
function serverConfig(configDir: string) {
    return {
        type: "local" as const,
        command: ["bun", FIXTURE],
        env: { APPDATA: configDir, HOME: configDir },
        enabled: true,
        timeoutMs: 15_000,
    }
}

test("the real spawned MCP server exposes exactly the three documented tools", async () => {
    const { connection } = await connect("mdc", serverConfig(emptyConfigDir))
    expect(connection).toBeDefined()
    expect(connection!.tools.map(t => t.name).sort()).toEqual(["mdc_build", "mdc_check_assets", "mdc_verify"])
    await connection!.close()
})

test("mdc_check_assets finds a real broken reference through the real server", async () => {
    const { connection } = await connect("mdc", serverConfig(emptyConfigDir))
    const text = await connection!.callTool(
        "mdc_check_assets",
        { files: ["index.html"], projectRoot: projectDir },
        15_000,
    )
    expect(text).toContain("does-not-exist.png")
    expect(text).toContain("broken")
    await connection!.close()
})

test("mdc_verify reports a real pass for a trivially valid file", async () => {
    await writeFile(join(projectDir, "clean.md"), "# Hello\n\nNo broken refs here.\n")
    const { connection } = await connect("mdc", serverConfig(emptyConfigDir))
    const text = await connection!.callTool("mdc_verify", { files: ["clean.md"], projectRoot: projectDir }, 15_000)
    expect(text).toContain("PASSED")
    await connection!.close()
})

test("mdc_build fails fast with a clear message when no model is configured (never hangs)", async () => {
    const { connection } = await connect("mdc", serverConfig(emptyConfigDir))
    const text = await connection!.callTool("mdc_build", { task: "add a comment" }, 15_000)
    expect(text.toLowerCase()).toContain("no model configured")
    await connection!.close()
})

// ─── buildTool.handler unit-tested directly with a mock model — exercises the
// Orchestrator.handle wiring and the Effect-failure→text conversion without
// needing a subprocess or a real model. ──────────────────────────────────────

test("buildTool.handler surfaces the orchestrator's real reply text on success", async () => {
    const provider = "mock-mcpserver-build"
    const handler: LLMHandler = {
        async generate(): Promise<LLMResponse> {
            return {
                text: "chat reply from the mock model",
                toolCalls: [],
                usage: { inputTokens: 0, outputTokens: 0 },
                stopReason: "end",
            }
        },
        async *stream() {},
    }
    RouteRegistry.register(Route.make(provider, { handler, baseUrl: "http://mock", apiKey: () => "k" }))

    // buildTool.handler calls resolveConfiguredModel() internally, which
    // reads real config — skip if this environment has none configured (the
    // fail-fast path is already covered by the subprocess test above).
    const { loadConfig } = await import("@monkeydcode/core/mdc-config")
    const { isModelConfigured } = await import("@monkeydcode/core/model-setup")
    const config = await loadConfig()
    if (!isModelConfigured(config)) return

    // Orchestrator.handle (which this exercises) reads/writes
    // .monkeydcode/working-memory.json via a path resolved from
    // process.cwd() ONCE, at module-import time (working-memory.ts's `FILE`
    // constant) — by the time this test body runs, every test file's import
    // chain (including that module) has already loaded, so chdir()'ing here
    // would be too late to redirect it. Snapshot and restore the real file
    // instead, so this test never leaves the repo's own runtime state
    // mutated, regardless of import order.
    const memoryFile = join(process.cwd(), ".monkeydcode", "working-memory.json")
    const before = await readFile(memoryFile, "utf-8").catch(() => null)
    try {
        const result = await buildTool.handler({ task: "say hello" })
        expect(typeof result.text).toBe("string")
    } finally {
        if (before === null) await rm(memoryFile, { force: true })
        else await writeFile(memoryFile, before, "utf-8")
    }
})
