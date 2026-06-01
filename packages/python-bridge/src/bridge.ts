import { spawn } from "child_process"
import { Socket } from "net"
import { join } from "path"
import { fileURLToPath } from "url"

const TOOLS_DIR = join(fileURLToPath(import.meta.url), "../../../../tools")
const SOCKET_PATH = `/tmp/mdc-bridge-${process.pid}.sock`
const READY_TIMEOUT_MS = 8000  // weak machines may need longer to import tree-sitter

interface BridgeState {
    socket: Socket
    pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
    nextId: number
    buf: string
}

let _state: BridgeState | null = null
let _connecting: Promise<BridgeState> | null = null

async function getState(): Promise<BridgeState> {
    if (_state) return _state
    // Prevent concurrent connect attempts
    if (_connecting) return _connecting
    _connecting = connect().finally(() => { _connecting = null })
    return _connecting
}

async function connect(): Promise<BridgeState> {
    const proc = spawn("uv", [
        "run", "python3",
        join(TOOLS_DIR, "src", "bridge_server.py"),
        SOCKET_PATH,
    ], {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: TOOLS_DIR,
    })

    proc.stderr?.on("data", (d: Buffer) => {
        // Surface Python-side warnings/errors during development
        process.stderr.write(`[bridge] ${d.toString()}`)
    })

    // Wait for "ready\n" on stdout, or timeout
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            // Timeout is not fatal — server may still be starting; try to connect anyway
            resolve()
        }, READY_TIMEOUT_MS)

        let buf = ""
        proc.stdout?.on("data", (d: Buffer) => {
            buf += d.toString()
            if (buf.includes("ready")) {
                clearTimeout(timer)
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
        socket.connect(SOCKET_PATH, resolve)
        socket.once("error", reject)
    })

    const s: BridgeState = { socket, pending: new Map(), nextId: 1, buf: "" }

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
            } catch {}
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

/** Ping the bridge — returns true if alive, false if not reachable */
export async function ping(): Promise<boolean> {
    try {
        const result = await call<string>("ping")
        return result === "pong"
    } catch {
        return false
    }
}

export function shutdown() {
    if (_state) { _state.socket.destroy(); _state = null }
}
