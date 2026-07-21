import { test, expect } from "bun:test"
import { fileURLToPath } from "url"
import { join, dirname } from "path"
import { client as createClientApp, ndJsonStream, AGENT_METHODS, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"

// Regression coverage for the exact class of bug the mcp-server-cli.test.ts
// caught: a stdio-server CLI entry that behaves correctly as a unit but
// breaks over the real stdio transport (wrong process.exit() timing, stray
// stdout writes corrupting the JSON-RPC framing, etc.). Spawns the REAL
// `bin/mdc acp` process and drives a real ACP handshake over its actual
// stdin/stdout — packages/acp's own tests only exercise the in-process
// AgentApp/ClientApp path, which cannot catch a CLI-wiring bug like that.
const BIN_MDC = join(dirname(fileURLToPath(import.meta.url)), "../../../bin/mdc")

/** Bun.spawn's stdin is a FileSink (Bun's own writer type), not a standard
 *  WritableStream — ndJsonStream needs the latter, so this adapts one. */
function toWritableStream(sink: { write(chunk: Uint8Array): unknown; end(): unknown }): WritableStream<Uint8Array> {
    return new WritableStream({
        write(chunk) {
            sink.write(chunk)
        },
        close() {
            sink.end()
        },
    })
}

test("`mdc acp` — the real CLI entry point — completes a real ACP handshake over actual stdio", async () => {
    const proc = Bun.spawn(["bun", BIN_MDC, "acp"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
    try {
        const stream = ndJsonStream(toWritableStream(proc.stdin), proc.stdout)
        const clientApp = createClientApp()

        const response = await clientApp.connectWith(stream, async ctx =>
            ctx.request(AGENT_METHODS.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }),
        )

        expect(response.protocolVersion).toBe(PROTOCOL_VERSION)
        expect(response.authMethods).toEqual([])
    } finally {
        proc.kill()
        await proc.exited
    }
}, 20_000)
