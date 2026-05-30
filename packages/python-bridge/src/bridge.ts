import { spawn } from "child_process"
import { Socket } from "net"
import { join } from "path"
import { fileURLToPath } from "url"

const TOOLS_DIR = join(fileURLToPath(import.meta.url), "../../../../tools")

interface BridgeState {
    socket: Socket
    pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
    nextId: number
    buf: string
}

let _state: BridgeState | null = null

async function getState(): Promise<BridgeState> {
    if (_state) return _state

    const socketPath = `/tmp/mdc-bridge-${process.pid}.sock`

    const proc = spawn("python3", [
        join(TOOLS_DIR, "src", "bridge_server.py"),
        socketPath,
    ], { stdio: ["ignore", "pipe", "pipe"], cwd: TOOLS_DIR })

    // Give the Python server up to 3 s to start
    await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3000)
        proc.stdout?.once("data", () => { clearTimeout(timer); resolve() })
        proc.once("error", () => { clearTimeout(timer); resolve() })
    })

    const socket = new Socket()
    await new Promise<void>((resolve, reject) => {
        socket.connect(socketPath, resolve)
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

export function shutdown() {
    if (_state) { _state.socket.destroy(); _state = null }
}
