import { expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { makeTempDir } from "@monkeydcode/core/util/tmp"
import { Effect, Exit } from "effect"
import { type DuplexLike, PythonBridge, callRpc, createState, live } from "../src/bridge.ts"
import { treeSitter } from "../src/client.ts"

// --- In-memory duplex socket for hermetic framing tests ---

interface FakeSocket extends DuplexLike {
    written: string[]
    emit(event: string, ...args: unknown[]): void
}

function fakeSocket(): FakeSocket {
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {}
    return {
        written: [],
        write(data: string) {
            this.written.push(data)
            return true
        },
        on(event: string, cb: (...a: unknown[]) => void) {
            const existing = listeners[event]
            if (existing) existing.push(cb)
            else listeners[event] = [cb]
            return this
        },
        destroy() {},
        emit(event: string, ...args: unknown[]) {
            for (const cb of listeners[event] ?? []) cb(...args)
        },
    }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

test("callRpc frames a newline-delimited JSON-RPC request", async () => {
    const socket = fakeSocket()
    const state = createState(socket)
    void Effect.runPromise(callRpc<string>(state, "ping", { a: 1 }))
    await tick()

    expect(socket.written).toHaveLength(1)
    expect(socket.written[0]!.endsWith("\n")).toBe(true)
    const req = JSON.parse(socket.written[0]!)
    expect(req).toMatchObject({ jsonrpc: "2.0", id: 1, method: "ping", params: { a: 1 } })
})

test("callRpc resolves with the result of the matching id", async () => {
    const socket = fakeSocket()
    const state = createState(socket)
    const promise = Effect.runPromise(callRpc<string>(state, "ping"))
    await tick()
    const req = JSON.parse(socket.written[0]!)
    socket.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: req.id, result: "pong" })}\n`)
    expect(await promise).toBe("pong")
})

test("callRpc ignores frames for unknown ids and matches the right one", async () => {
    const socket = fakeSocket()
    const state = createState(socket)
    const promise = Effect.runPromise(callRpc<number>(state, "compute"))
    await tick()
    const req = JSON.parse(socket.written[0]!)
    socket.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: 999, result: 0 })}\n`)
    socket.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: req.id, result: 7 })}\n`)
    expect(await promise).toBe(7)
})

test("callRpc fails on an rpc error response", async () => {
    const socket = fakeSocket()
    const state = createState(socket)
    const exit = Effect.runPromiseExit(callRpc(state, "boom"))
    await tick()
    const req = JSON.parse(socket.written[0]!)
    socket.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { message: "nope" } })}\n`)
    expect(Exit.isFailure(await exit)).toBe(true)
})

// --- Integration tests (require a live Python bridge: set MDC_PY_BRIDGE=1) ---

const INTEGRATION = !!process.env.MDC_PY_BRIDGE

test.skipIf(!INTEGRATION)("ping roundtrip (integration)", async () => {
    const program = Effect.gen(function* () {
        const bridge = yield* PythonBridge
        return yield* bridge.call<string>("ping")
    })
    const result = await Effect.runPromise(Effect.provide(program, live))
    expect(result).toBe("pong")
})

test.skipIf(!INTEGRATION)("extract signatures from TS (integration)", async () => {
    const dir = await makeTempDir("mdc-sig-")
    const f = join(dir, "sample.ts")
    await writeFile(f, "export function foo(x: number): number { return x + 1 }")
    const result = await Effect.runPromise(Effect.provide(treeSitter.extractSignatures(f), live))
    expect(result[0]!.name).toBe("foo")
})
