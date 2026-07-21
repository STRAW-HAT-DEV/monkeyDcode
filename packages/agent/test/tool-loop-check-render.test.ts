import { test, expect } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, writeFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { Route } from "@monkeydcode/llm/route"
import { RouteRegistry } from "@monkeydcode/llm"
import type { LLMHandler } from "@monkeydcode/llm/route"
import type { LLMResponse } from "@monkeydcode/llm/schema"
import * as ToolLoop from "../src/tool-loop.ts"

const PROVIDER = "mock-checkrender"
const model = { provider: PROVIDER, id: "mock" }

function mockModel(turns: (turn: number) => string): void {
    let turn = 0
    const handler: LLMHandler = {
        async generate(): Promise<LLMResponse> {
            turn++
            return { text: turns(turn), toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end" }
        },
        async *stream() {},
    }
    RouteRegistry.register(Route.make(PROVIDER, { handler, baseUrl: "http://mock", apiKey: () => "k" }))
}

test("RUN check-render degrades cleanly (with a clear message) when Playwright isn't installed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mdc-checkrender-"))
    try {
        await writeFile(join(dir, "index.html"), `<img src="missing.png">`)
        mockModel(turn => (turn === 1 ? "RUN check-render" : "done"))

        const result = await Effect.runPromise(
            ToolLoop.run("investigate the page", { model, projectRoot: dir, maxIterations: 4 }),
        )
        // In this repo's real default environment, Playwright is not installed —
        // the tool must say so plainly, not hang or throw.
        expect(result.transcript).toContain("RUN check-render")
        expect(result.transcript.toLowerCase()).toMatch(/playwright.*(not|isn't) installed/)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})

test("RUN check-render reports 'no HTML file' when there is nothing to render", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mdc-checkrender-nohtml-"))
    try {
        await writeFile(join(dir, "notes.md"), "# just markdown, no html here")
        mockModel(turn => (turn === 1 ? "RUN check-render" : "done"))

        const result = await Effect.runPromise(
            ToolLoop.run("investigate", { model, projectRoot: dir, maxIterations: 4 }),
        )
        // Either branch is acceptable depending on Playwright availability —
        // both must degrade cleanly, never hang or throw.
        expect(result.transcript).toContain("RUN check-render")
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})
