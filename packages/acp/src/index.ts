import { Readable, Writable } from "stream"
import { ndJsonStream } from "@agentclientprotocol/sdk"
import { buildAgentApp } from "./agent.ts"

export { buildAgentApp } from "./agent.ts"

/** Start the ACP agent on stdio. Resolves once the connection actually
 *  closes (ndJsonStream's underlying transport keeps the process alive on
 *  its own; there's nothing further this function needs to await). */
export async function startAcpAgent(): Promise<void> {
    // Cast through `unknown` first: Node's Readable/Writable.toWeb() return
    // ReadableStream/WritableStream typed against Node's own lib.dom-adjacent
    // globals, which don't structurally match the SDK's Web Streams types
    // under every consuming package's tsconfig/lib combination (observed
    // concretely: packages/acp typechecks this file fine standalone, but
    // packages/tui — which pulls in @opentui/react's own DOM-lib footprint —
    // resolves the ambient ReadableStream/WritableStream generics differently
    // and rejects a direct `as`). The values are correct at runtime either way;
    // this only works around a cross-package type-identity mismatch.
    const stream = ndJsonStream(
        Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>,
        Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
    )
    const connection = buildAgentApp().connect(stream)
    await connection.closed
}
