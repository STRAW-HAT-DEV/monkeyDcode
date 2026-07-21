import { spawn, type ChildProcess } from "child_process"
import { Socket } from "net"
import { join } from "path"
import { fileURLToPath } from "url"
import { tmpdir } from "os"
import { unlinkSync, existsSync } from "fs"

const TOOLS_DIR = join(fileURLToPath(import.meta.url), "../../../../tools")
const READY_TIMEOUT_MS = Number(process.env["MDCODE_BRIDGE_READY_TIMEOUT_MS"]) || 15_000

interface BridgeState {
    socket: Socket
    pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
    nextId: number
    buf: string
    process: ChildProcess
}

let _state: BridgeState | null = null
let _connecting: Promise<BridgeState> | null = null

function socketEndpoint(): { kind: "unix"; path: string } | { kind: "tcp"; host: string; port: number } {
    if (process.platform === "win32") {
        return { kind: "tcp", host: "127.0.0.1", port: 0 }
    }
    return { kind: "unix", path: join(tmpdir(), `mdc-bridge-${process.pid}.sock`) }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error("Bridge connection timeout")), ms),
        ),
    ])
}

// Cold `uv run python` boot (env resolve + module imports) measured at ~8.2s,
// and connect() itself waits up to READY_TIMEOUT_MS (15s) for the server's
// "ready" line. The outer guard must sit ABOVE both, or it aborts a bridge that
// was about to come up — which is exactly what caused every session to fall back
// to degraded, graph-less mode. Overridable for slower machines / first-ever run.
const CONNECT_TIMEOUT_MS = Number(process.env["MDCODE_BRIDGE_CONNECT_TIMEOUT_MS"]) || 25_000

async function getState(): Promise<BridgeState> {
    if (_state) return _state
    if (_connecting) return _connecting
    _connecting = withTimeout(connect(), CONNECT_TIMEOUT_MS).finally(() => { _connecting = null })
    return _connecting
}

async function connect(): Promise<BridgeState> {
    const endpoint = socketEndpoint()
    const arg = endpoint.kind === "unix"
        ? endpoint.path
        : "tcp://0"

    const proc = spawn("uv", [
        "run", "python",
        join(TOOLS_DIR, "src", "bridge_server.py"),
        arg,
    ], {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: TOOLS_DIR,
        shell: process.platform === "win32",
    })

    proc.stderr?.on("data", (d: Buffer) => {
        // In interactive TUI mode, raw stderr output can corrupt the terminal UI and break input.
        if (process.env.MDCODE_BRIDGE_VERBOSE === "1") {
            process.stderr.write(`[bridge] ${d.toString()}`)
        }
    })

    let connectTarget: { host: string; port: number } | { path: string } =
        endpoint.kind === "unix" ? { path: endpoint.path } : { host: "127.0.0.1", port: 0 }

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => resolve(), READY_TIMEOUT_MS)
        let buf = ""

        proc.stdout?.on("data", (d: Buffer) => {
            buf += d.toString()
            if (buf.includes("ready")) {
                clearTimeout(timer)
                if (endpoint.kind === "tcp") {
                    const m = buf.match(/ready tcp:\/\/([\d.]+):(\d+)/)
                    if (m) {
                        connectTarget = { host: m[1]!, port: Number(m[2]) }
                    }
                }
                resolve()
            }
        })

        proc.once("error", (e) => {
            clearTimeout(timer)
            reject(e)
        })

        proc.once("exit", (code) => {
            if (code !== null && code !== 0) {
                clearTimeout(timer)
                reject(new Error(`Bridge process exited with code ${code}`))
            }
        })
    })

    const socket = new Socket()
    await new Promise<void>((resolve, reject) => {
        if ("port" in connectTarget!) {
            socket.connect(connectTarget.port, connectTarget.host, resolve)
        } else {
            socket.connect(connectTarget!.path, resolve)
        }
        socket.once("error", reject)
    })

    const s: BridgeState = {
        socket,
        pending: new Map(),
        nextId: 1,
        buf: "",
        process: proc,
    }

    socket.on("data", (chunk: Buffer) => {
        s.buf += chunk.toString()
        const lines = s.buf.split("\n")
        s.buf = lines.pop() ?? ""
        for (const line of lines) {
            if (!line.trim()) continue
            try {
                const resp = JSON.parse(line) as {
                    id: number
                    result?: unknown
                    error?: { message: string }
                }
                const p = s.pending.get(resp.id)
                if (p) {
                    s.pending.delete(resp.id)
                    if (resp.error) p.reject(new Error(resp.error.message))
                    else p.resolve(resp.result)
                }
            } catch { /* ignore malformed */ }
        }
    })

    socket.once("close", () => { _state = null })
    socket.once("error", () => { _state = null })

    _state = s
    return s
}

export async function call<T>(method: string, params?: unknown): Promise<T> {
    const s = await getState()
    return new Promise<T>((resolve, reject) => {
        const id = s.nextId++
        s.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
        s.socket.write(msg, (err) => {
            if (err) { s.pending.delete(id); reject(err) }
        })
    })
}

export async function ping(): Promise<boolean> {
    try {
        const result = await call<string>("ping")
        return result === "pong"
    } catch {
        return false
    }
}

export function shutdown() {
    if (_state) {
        _state.socket.destroy()
        try { _state.process.kill() } catch { /* ignore */ }
        _state = null
    }
}

export function isBridgeAvailable(): boolean {
    return _state !== null
}
