import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { applyChange } from "../src/build-agent.ts"
import { Effect } from "effect"
import { contentTag, globalSnapshotStore } from "@monkeydcode/hashline"

async function runEffect<A>(eff: Effect.Effect<A, unknown>): Promise<A> {
    return Effect.runPromise(eff)
}

describe("applyChange hashline", () => {
    test("applies hashline patch to existing file", async () => {
        const dir = await mkdtemp(join(tmpdir(), "mdc-hashline-"))
        const file = join(dir, "foo.ts")
        await writeFile(file, "const a = 1\nconst b = 2\n", "utf-8")
        globalSnapshotStore.record(file, "const a = 1\nconst b = 2\n")
        const tag = contentTag("const a = 1\nconst b = 2\n")

        const change = `\`\`\`hashline
[foo.ts#${tag}]
replace 1..1:
+const a = 42
\`\`\``

        await runEffect(applyChange(change, [file]))
        const out = await readFile(file, "utf-8")
        expect(out).toBe("const a = 42\nconst b = 2\n")
    })

    test("rejects hashline patch that would introduce syntax error", async () => {
        const dir = await mkdtemp(join(tmpdir(), "mdc-hashline-syntax-"))
        const name = "syntax-gate.ts"
        const file = join(dir, name)
        const content = "const a = 1\nconst b = 2\n"
        await writeFile(file, content, "utf-8")
        globalSnapshotStore.record(name, content)
        const tag = contentTag(content)

        const change = `\`\`\`hashline
[${name}#${tag}]
replace 1..1:
+const a = {
\`\`\``

        await expect(runEffect(applyChange(change, [file]))).rejects.toThrow(/Syntax check failed/)
        const out = await readFile(file, "utf-8")
        expect(out).toBe(content)
    })
})
