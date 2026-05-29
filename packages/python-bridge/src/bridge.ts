// EXPERIMENTAL: TypeScript ↔ Python bridge over a Unix socket.
// Speaks newline-delimited JSON-RPC 2.0. Requires `uv` and the `tools` Python
// package to be installed for the live path; the RPC framing itself is pure and
// unit-tested with an in-memory duplex socket.

import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { connect } from "node:net"
import { homedir } from "node:os"
import { join } from "node:path"
import { Context, Data, Effect, Layer } from "effect"

export class PythonBridgeError extends Data.TaggedError("PythonBridgeError")<{
    kind: "spawn_failed" | "connection_lost" | "timeout" | "rpc_error"
    message: string
}> {}

export interface BridgeInterface {
    call: <T>(method: string, params?: unknown) => Effect.Effect<T, PythonBridgeError>
    shutdown: () => Effect.Effect<void>
}

export class PythonBridge extends Context.Service<PythonBridge, BridgeInterface>()("@monkeydcode/PythonBridge") {}

const RPC_TIMEOUT_MS = 30_000
const CONNECT_TIMEOUT_MS = 5_000
const POLL_INTERVAL_MS = 100

interface Pending {
    resolve: (value: unknown) => void
    reject: (error: PythonBridgeError) => void
}

// Minimal duplex surface — lets unit tests inject an in-memory socket.
export interface DuplexLike {
    write(data: string): unknown
    on(event: string, listener: (...args: any[]) => void): unknown
    destroy(): unknown
}

export interface BridgeState {
    process: ChildProcess | null
    socket: DuplexLike
    pending: Map<number, Pending>
    nextId: number
    buffer: string
}

/** Create bridge state around an already-connected socket and wire up the reader. */
export function createState(socket: DuplexLike, process: ChildProcess | null = null): BridgeState {
    const state: BridgeState = { process, socket, pending: new Map(), nextId: 1, buffer: "" }
    attachReader(state)
    return state
}

function attachReader(state: BridgeState): void {
    state.socket.on("data", (chunk: Buffer | string) => {
        state.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8")
        let idx = state.buffer.indexOf("\n")
        while (idx >= 0) {
            const line = state.buffer.slice(0, idx)
            state.buffer = state.buffer.slice(idx + 1)
            if (line.trim()) handleLine(state, line)
            idx = state.buffer.indexOf("\n")
        }
    })
    state.socket.on("error", (err: Error) => failAll(state, err.message))
    state.socket.on("close", () => failAll(state, "socket closed"))
}

function handleLine(state: BridgeState, line: string): void {
    let msg: { id?: unknown; result?: unknown; error?: { message?: string } }
    try {
        msg = JSON.parse(line)
    } catch {
        return // ignore malformed frames
    }
    if (typeof msg.id !== "number") return
    const pending = state.pending.get(msg.id)
    if (!pending) return
    state.pending.delete(msg.id)
    if (msg.error) {
        pending.reject(new PythonBridgeError({ kind: "rpc_error", message: msg.error.message ?? "RPC error" }))
    } else {
        pending.resolve(msg.result)
    }
}

function failAll(state: BridgeState, message: string): void {
    for (const pending of state.pending.values()) {
        pending.reject(new PythonBridgeError({ kind: "connection_lost", message }))
    }
    state.pending.clear()
}

/** Send a single JSON-RPC request and resolve with its result (TS-side timeout). */
export function callRpc<T>(state: BridgeState, method: string, params?: unknown): Effect.Effect<T, PythonBridgeError> {
    return Effect.callback<T, PythonBridgeError>((resume) => {
        const id = state.nextId++
        let timer: ReturnType<typeof setTimeout> | null = null
        const settle = (effect: Effect.Effect<T, PythonBridgeError>): void => {
            if (timer) clearTimeout(timer)
            state.pending.delete(id)
            resume(effect)
        }

        state.pending.set(id, {
            resolve: (value) => settle(Effect.succeed(value as T)),
            reject: (error) => settle(Effect.fail(error)),
        })
        timer = setTimeout(
            () => settle(Effect.fail(new PythonBridgeError({ kind: "timeout", message: `RPC "${method}" timed out` }))),
            RPC_TIMEOUT_MS,
        )

        const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} })}\n`
        try {
            state.socket.write(payload)
        } catch (e) {
            settle(Effect.fail(new PythonBridgeError({ kind: "connection_lost", message: String(e) })))
        }
    })
}

function dataDir(): string {
    const dir = join(homedir(), ".local", "share", "monkeydcode")
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    return dir
}

function defaultSocketPath(): string {
    return process.env.MDC_PY_BRIDGE_SOCKET ?? join(dataDir(), `bridge-${process.pid}.sock`)
}

const BRIDGE_CMD = (process.env.MDC_PY_BRIDGE_CMD ?? "uv run python -m tools.bridge_server").split(" ").filter(Boolean)

/** Spawn the Python bridge process and connect to its Unix socket. */
export function spawnBridge(): Effect.Effect<BridgeState, PythonBridgeError> {
    return Effect.callback<BridgeState, PythonBridgeError>((resume) => {
        const socketPath = defaultSocketPath()
        const [cmd, ...cmdArgs] = BRIDGE_CMD
        if (!cmd) {
            resume(Effect.fail(new PythonBridgeError({ kind: "spawn_failed", message: "empty bridge command" })))
            return
        }

        const child = spawn(cmd, [...cmdArgs, "--socket", socketPath], {
            cwd: process.env.MDC_TOOLS_DIR,
            stdio: ["ignore", "inherit", "inherit"],
        })
        let settled = false
        child.on("error", (e) => {
            if (settled) return
            settled = true
            resume(Effect.fail(new PythonBridgeError({ kind: "spawn_failed", message: e.message })))
        })

        const deadline = Date.now() + CONNECT_TIMEOUT_MS
        const tryConnect = (): void => {
            if (settled) return
            if (!existsSync(socketPath)) {
                if (Date.now() > deadline) {
                    settled = true
                    child.kill()
                    resume(
                        Effect.fail(
                            new PythonBridgeError({
                                kind: "spawn_failed",
                                message: "bridge socket did not appear within 5s",
                            }),
                        ),
                    )
                    return
                }
                setTimeout(tryConnect, POLL_INTERVAL_MS)
                return
            }

            const socket = connect(socketPath)
            socket.once("connect", () => {
                if (settled) return
                settled = true
                resume(Effect.succeed(createState(socket as unknown as DuplexLike, child)))
            })
            socket.once("error", (e: Error) => {
                if (settled) return
                if (Date.now() > deadline) {
                    settled = true
                    resume(Effect.fail(new PythonBridgeError({ kind: "connection_lost", message: e.message })))
                } else {
                    setTimeout(tryConnect, POLL_INTERVAL_MS)
                }
            })
        }
        setTimeout(tryConnect, POLL_INTERVAL_MS)
    })
}

export const live = Layer.effect(
    PythonBridge,
    Effect.gen(function* () {
        const state = yield* spawnBridge()
        return PythonBridge.of({
            call: <T>(method: string, params?: unknown) => callRpc<T>(state, method, params),
            shutdown: () =>
                Effect.sync(() => {
                    state.process?.kill()
                    state.socket.destroy()
                }),
        })
    }),
)
