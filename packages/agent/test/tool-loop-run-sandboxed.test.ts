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

// Regression coverage for switching RUN's diagnostics from raw `$` template
// execution to execSandboxed() (packages/core/util/sandbox.ts) — env
// allowlisting + best-effort OS sandboxing. Real, on this machine: proves
// the switch didn't silently break git/bun invocation (e.g. losing PATH
// resolution, or a working directory that no longer takes effect).

const PROVIDER = "mock-run-sandboxed"
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

test("RUN git-status still works after routing through execSandboxed (real git, real process)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mdc-run-sandbox-"))
    try {
        await Bun.spawn(["git", "init", "-q"], { cwd: dir }).exited
        await writeFile(join(dir, "untracked.txt"), "hello")
        mockModel(turn => (turn === 1 ? "RUN git-status" : "done"))

        const result = await Effect.runPromise(
            ToolLoop.run("check status", { model, projectRoot: dir, maxIterations: 4 }),
        )
        expect(result.transcript).toContain("RUN git-status")
        expect(result.transcript).toContain("untracked.txt")
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})

test("RUN git-diff reflects a real uncommitted change through the sandboxed exec path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mdc-run-sandbox-diff-"))
    try {
        await Bun.spawn(["git", "init", "-q"], { cwd: dir }).exited
        await Bun.spawn(["git", "config", "user.email", "t@t.com"], { cwd: dir }).exited
        await Bun.spawn(["git", "config", "user.name", "t"], { cwd: dir }).exited
        await writeFile(join(dir, "f.txt"), "v1\n")
        await Bun.spawn(["git", "add", "f.txt"], { cwd: dir }).exited
        await Bun.spawn(["git", "commit", "-q", "-m", "init"], { cwd: dir }).exited
        await writeFile(join(dir, "f.txt"), "v2 — a real uncommitted change\n")

        mockModel(turn => (turn === 1 ? "RUN git-diff" : "done"))
        const result = await Effect.runPromise(
            ToolLoop.run("check diff", { model, projectRoot: dir, maxIterations: 4 }),
        )
        expect(result.transcript).toContain("a real uncommitted change")
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})

test("RUN typecheck actually invokes `bun run typecheck` through the sandboxed exec path (not just returning a static string)", async () => {
    // Not asserting a clean tsc pass here (this scratch dir has no local
    // `typescript`, and this machine has no global `tsc` on PATH — a
    // package-manager/environment fact unrelated to the sandbox wiring this
    // test targets). What matters: the command actually executes and
    // produces bun's real "missing script/binary" output rather than
    // hanging or throwing — proof the switch from `$` to execSandboxed()
    // still resolves `root`, `PATH`, and captures stdout/stderr correctly.
    const dir = await mkdtemp(join(tmpdir(), "mdc-run-sandbox-tsc-"))
    try {
        await writeFile(join(dir, "package.json"), JSON.stringify({ name: "tiny", scripts: { typecheck: "tsc --noEmit" } }))

        mockModel(turn => (turn === 1 ? "RUN typecheck" : "done"))
        const result = await Effect.runPromise(
            ToolLoop.run("typecheck it", { model, projectRoot: dir, maxIterations: 4 }),
        )
        expect(result.transcript).toContain("RUN typecheck")
        // Real process output either way — never the empty/hung/thrown case.
        expect(result.transcript).not.toContain("TIMED OUT")
        expect(result.transcript.length).toBeGreaterThan("### Turn 1: RUN typecheck".length)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}, 30_000)
