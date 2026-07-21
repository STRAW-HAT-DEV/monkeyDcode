import { test, expect, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, writeFile, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { Route } from "@monkeydcode/llm/route"
import { RouteRegistry } from "@monkeydcode/llm"
import type { LLMHandler } from "@monkeydcode/llm/route"
import type { LLMResponse } from "@monkeydcode/llm/schema"
import * as AssetFix from "../src/sub-agents/asset-fix.ts"
import * as Changes from "../src/changes.ts"

let root: string
const PROVIDER = "mock-assetfix"

function mockModel(reply: (userText: string) => string): void {
    const handler: LLMHandler = {
        async generate(req): Promise<LLMResponse> {
            const userText = req.messages.map(m => m.content).join("\n")
            return { text: reply(userText), toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end" }
        },
        async *stream() {},
    }
    RouteRegistry.register(Route.make(PROVIDER, { handler, baseUrl: "http://mock", apiKey: () => "k" }))
}

const model = { provider: PROVIDER, id: "mock" }

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "mdc-assetfix-"))
    Changes.reset()
})
afterEach(async () => {
    await rm(root, { recursive: true, force: true })
})

test("finds the broken local ref, asks the model for a replacement value, substitutes it, and re-validates", async () => {
    await writeFile(join(root, "index.html"), `<h1><img src="missing-logo.png"> Brand</h1>`)

    // The model returns ONLY a replacement value (a data: URI, which validates).
    // The substitution into the file is done deterministically, not by the model.
    mockModel(() => "data:image/svg+xml,%3Csvg/%3E")

    const outcome = await Effect.runPromise(AssetFix.fix("logo not rendering", model, root))
    expect(outcome.hadBrokenRefs).toBe(true)
    expect(outcome.fixed).toBe(true)

    const html = await readFile(join(root, "index.html"), "utf-8")
    expect(html).toContain("data:image/svg+xml")
    expect(html).not.toContain("missing-logo.png")
    // The rest of the file is preserved verbatim — surgical replacement.
    expect(html).toContain("Brand")
    expect(html).toContain("<h1>")
    expect(Changes.take()).toContain(join(root, "index.html"))
})

test("prose / apology responses are rejected — no garbage written to the file", async () => {
    await writeFile(join(root, "index.html"), `<img src="gone.png">`)
    mockModel(() => "I'm sorry, I cannot determine the correct image URL for this asset.")

    const outcome = await Effect.runPromise(AssetFix.fix("logo not rendering", model, root))
    expect(outcome.fixed).toBe(false)
    const html = await readFile(join(root, "index.html"), "utf-8")
    expect(html).toBe(`<img src="gone.png">`) // untouched — prose was not substituted
})

test("reports hadBrokenRefs=false when nothing is broken (caller should fall back)", async () => {
    await writeFile(join(root, "ok.svg"), "<svg/>")
    await writeFile(join(root, "index.html"), `<img src="ok.svg">`)
    let called = false
    mockModel(() => { called = true; return "should not be asked" })

    const outcome = await Effect.runPromise(AssetFix.fix("make it prettier", model, root))
    expect(outcome.hadBrokenRefs).toBe(false)
    expect(outcome.fixed).toBe(false)
    expect(called).toBe(false) // no broken refs → the model is never invoked
})

test("if the model's first fix is still broken, a second round with feedback recovers it", async () => {
    await writeFile(join(root, "index.html"), `<img src="dead-a.png">`)
    await writeFile(join(root, "real.png"), "x")

    let calls = 0
    mockModel(() => {
        calls++
        // Round 1: swap the missing file for ANOTHER missing file (still broken).
        // Round 2 (feedback prompt): point at the real, existing file.
        return calls === 1 ? "dead-b.png" : "real.png"
    })

    const outcome = await Effect.runPromise(AssetFix.fix("image broken", model, root))
    expect(outcome.fixed).toBe(true)
    expect(calls).toBe(2) // needed the retry round
    const html = await readFile(join(root, "index.html"), "utf-8")
    expect(html).toContain("real.png")
})
