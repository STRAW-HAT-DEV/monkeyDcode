import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { compact, shouldCompact } from "../src/compaction.ts"

test("shouldCompact is false below the threshold", () => {
    expect(shouldCompact(0)).toBe(false)
    expect(shouldCompact(3)).toBe(false)
})

test("shouldCompact triggers every 5 messages", () => {
    expect(shouldCompact(5)).toBe(true)
    expect(shouldCompact(10)).toBe(true)
    expect(shouldCompact(7)).toBe(false)
})

test("compact is an honest stub that fails loudly (NotImplemented)", async () => {
    const exit = await Effect.runPromiseExit(compact([{ role: "user", content: "hi" }]))
    expect(Exit.isFailure(exit)).toBe(true)
})
