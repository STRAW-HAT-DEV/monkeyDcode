import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { makeTempDir } from "@monkeydcode/core/util/tmp"
import { Effect, Exit } from "effect"
import { applyChange } from "../src/build-agent.ts"

test("applyChange writes the change inside the root", async () => {
    const root = await makeTempDir("mdc-build-")
    const written = await Effect.runPromise(applyChange("export const x = 1\n", ["out.ts"], root))
    expect(written).toBe(join(root, "out.ts"))
    expect(await readFile(join(root, "out.ts"), "utf-8")).toBe("export const x = 1\n")
})

test("applyChange refuses path traversal (security regression)", async () => {
    const root = await makeTempDir("mdc-build-")
    const exit = await Effect.runPromiseExit(applyChange("pwned", ["../../etc/escape.ts"], root))
    expect(Exit.isFailure(exit)).toBe(true)
})

test("applyChange returns null when there is no target file", async () => {
    const root = await makeTempDir("mdc-build-")
    expect(await Effect.runPromise(applyChange("x", [], root))).toBeNull()
})
