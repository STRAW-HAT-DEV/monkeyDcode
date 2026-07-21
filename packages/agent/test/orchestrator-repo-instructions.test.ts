import { test, expect } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, writeFile, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { Route } from "@monkeydcode/llm/route"
import { RouteRegistry } from "@monkeydcode/llm"
import type { LLMHandler } from "@monkeydcode/llm/route"
import type { LLMResponse } from "@monkeydcode/llm/schema"
import { handle } from "../src/orchestrator.ts"

// Proves AGENTS.md content actually reaches a real sub-agent's prompt through
// orchestrator.ts's augmentedMessage — not just that repo-instructions.ts
// reads the file correctly in isolation (already covered separately).
// Routed through the asset_fix path deliberately: it's the one sub-agent
// whose prompt construction is simple enough to assert against directly
// (buildReplacementPrompt includes the task text verbatim as "User request:").

const PROVIDER = "mock-orchestrator-repoinstr"
const model = { provider: PROVIDER, id: "mock" }

test("AGENTS.md content reaches the sub-agent's actual prompt via the orchestrator", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mdc-orch-repoinstr-"))
    const originalCwd = process.cwd()
    // working-memory.ts resolves its file path from process.cwd() ONCE, at
    // module-import time — by now (any earlier test file that touched
    // orchestrator.ts) that's frozen to the real monorepo root regardless of
    // this test's own chdir. WorkingMemory.setGoal() inside handle() would
    // therefore write to THIS repo's real .monkeydcode/working-memory.json.
    // Snapshot and restore it, same fix as mcp-server/test/server.test.ts.
    const memoryFile = join(originalCwd, ".monkeydcode", "working-memory.json")
    const memoryBefore = await readFile(memoryFile, "utf-8").catch(() => null)
    try {
        await writeFile(join(dir, "AGENTS.md"), "MARKER-UNIQUE-INSTRUCTION-9f3a: always use single quotes.")
        await writeFile(join(dir, "index.html"), `<img src="missing-for-real.png">`)
        process.chdir(dir)

        let capturedPrompt = ""
        let turn = 0
        const handler: LLMHandler = {
            async generate(req): Promise<LLMResponse> {
                turn++
                capturedPrompt += req.messages.map(m => m.content).join("\n")
                // Turn 1 is classify() — any non-"chat" category routes on to
                // isAssetBug()'s deterministic reclassification to "asset_fix".
                // Turn 2+ is AssetFix's replacement-value prompt.
                const text = turn === 1 ? "general" : "data:image/svg+xml,%3Csvg/%3E"
                return { text, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end" }
            },
            async *stream() {},
        }
        RouteRegistry.register(Route.make(PROVIDER, { handler, baseUrl: "http://mock", apiKey: () => "k" }))

        await Effect.runPromise(handle("the logo image is not rendering", model, "mock", []))

        expect(capturedPrompt).toContain("MARKER-UNIQUE-INSTRUCTION-9f3a")
    } finally {
        process.chdir(originalCwd)
        if (memoryBefore === null) await rm(memoryFile, { force: true })
        else await writeFile(memoryFile, memoryBefore, "utf-8")
        await rm(dir, { recursive: true, force: true })
    }
// initSessionContext() (python-bridge knowledge-graph indexing) can take
// 8s+ to start on its first call in a session — a known, previously-measured
// real cost (see python-bridge/src/bridge.ts), not a hang.
}, 30_000)
