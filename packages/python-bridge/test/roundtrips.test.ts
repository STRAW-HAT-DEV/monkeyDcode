import { test, expect } from "bun:test"
import { writeFile, unlink } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { shutdown } from "../src/bridge.ts"
import { treeSitter } from "../src/client.ts"

const sampleFile = join(tmpdir(), `mdc-sample-${Date.now()}.ts`)

test("regex fallback extracts signatures without bridge", async () => {
    await writeFile(sampleFile, `export function foo(x: number): number { return x + 1 }`)
    const sigs = await treeSitter.extractSignatures(sampleFile)
    expect(sigs.length).toBeGreaterThan(0)
    expect(sigs[0]!.name).toBe("foo")
    await unlink(sampleFile).catch(() => {})
    shutdown()
}, 10_000)

test("parseAST fallback returns structure", async () => {
    await writeFile(sampleFile, `export function bar() { return 1 }`)
    const ast = await treeSitter.parseAST(sampleFile)
    expect(ast.file).toBe(sampleFile)
    await unlink(sampleFile).catch(() => {})
    shutdown()
}, 10_000)
