// The monkeyDcode ACP agent — GAPS.md Part 2, C5.
//
// Implements the handful of ACP methods an agent must support (initialize,
// session/new, session/prompt, session/cancel) by delegating straight to
// Orchestrator.handle — the exact same code path `mdc "<task>"` and
// `mdc_build` (the MCP server tool) already run. An ACP-connected editor
// (Zed, or anything else that speaks ACP) gets the real agent: capability
// tiering, multi-temperature sampling, verification, hashline patches — not
// a stripped-down protocol shim.
//
// Scope, honestly stated: prompt streaming sends the final reply as ONE
// agent_message_chunk, not incremental token-by-token deltas — true
// incremental streaming would require restructuring Orchestrator.handle to
// emit partial output as it goes, a real architectural change orthogonal to
// "support ACP at all." Cancellation is best-effort: session/cancel marks
// the session so an in-flight prompt reports `stopReason: "cancelled"` once
// Orchestrator.handle's Effect resolves, but does not abort generation
// mid-flight — Orchestrator.handle has no internal cancellation
// checkpoints to hook into today. Both are documented gaps, not silent ones.

import { Effect, Cause } from "effect"
import { randomUUID } from "crypto"
import { AGENT_METHODS, CLIENT_METHODS, agent as createAgentApp, type AgentApp } from "@agentclientprotocol/sdk"
import type { InitializeRequest, InitializeResponse, NewSessionRequest, NewSessionResponse, PromptRequest, PromptResponse, ContentBlock } from "@agentclientprotocol/sdk"
import { handle as orchestrate } from "@monkeydcode/agent/orchestrator"
import type { Message } from "@monkeydcode/llm/schema"
import { resolveConfiguredModel } from "./model.ts"
import { describeError } from "./error.ts"

export const AGENT_NAME = "monkeydcode"
export const AGENT_VERSION = "0.1.0"

interface Session {
    cwd: string
    history: Message[]
    cancelled: boolean
}

const sessions = new Map<string, Session>()

/** Only the plain-text content blocks are used — ACP's image/audio/resource
 *  variants aren't advertised in this agent's promptCapabilities (see
 *  buildAgentApp's initialize handler), so a spec-compliant client won't
 *  send them, but a non-compliant one might; ignoring rather than crashing
 *  on an unsupported block type is the correct degrade. */
function extractText(blocks: ContentBlock[]): string {
    return blocks
        .filter((b): b is ContentBlock & { type: "text" } => b.type === "text")
        .map(b => b.text)
        .join("\n")
}

function handleInitialize(params: InitializeRequest): InitializeResponse {
    return {
        protocolVersion: params.protocolVersion,
        agentCapabilities: {
            loadSession: false,
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
        },
        authMethods: [], // no auth required — this agent runs entirely locally
        agentInfo: { name: AGENT_NAME, version: AGENT_VERSION },
    }
}

function handleNewSession(params: NewSessionRequest): NewSessionResponse {
    const sessionId = randomUUID()
    sessions.set(sessionId, { cwd: params.cwd, history: [], cancelled: false })
    return { sessionId }
}

async function handlePrompt(
    params: PromptRequest,
    notifyUpdate: (sessionId: string, text: string) => Promise<void>,
): Promise<PromptResponse> {
    const session = sessions.get(params.sessionId)
    if (!session) {
        throw new Error(`Unknown session "${params.sessionId}" — call session/new first`)
    }

    const text = extractText(params.prompt)
    session.history.push({ role: "user", content: text })

    const { model, modelId } = await resolveConfiguredModel()
    const originalCwd = process.cwd()
    // Orchestrator.handle reads process.cwd() throughout (build-agent,
    // working-memory, MCP/permission/web-search config loading) rather than
    // taking a root parameter — same constraint documented in
    // mcp-server/src/tools/build.ts. An ACP session's cwd comes from the
    // client per session/new, so this session's work must happen there.
    process.chdir(session.cwd)
    let exit
    try {
        exit = await Effect.runPromiseExit(orchestrate(text, model, modelId, session.history.slice(0, -1)))
    } finally {
        process.chdir(originalCwd)
    }

    if (session.cancelled) {
        return { stopReason: "cancelled" }
    }

    const reply = exit._tag === "Success" ? exit.value : `Error: ${describeError(Cause.squash(exit.cause))}`
    session.history.push({ role: "assistant", content: reply })
    await notifyUpdate(params.sessionId, reply)

    return { stopReason: "end_turn" }
}

function handleCancel(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (session) session.cancelled = true
}

/** Builds the ACP agent app — separated from startAcpAgent() (index.ts) so
 *  tests can connect it directly via AgentApp.connect(clientApp) without a
 *  real stdio transport (see test/agent.test.ts). */
export function buildAgentApp(): AgentApp {
    return createAgentApp({ name: AGENT_NAME })
        .onRequest(AGENT_METHODS.initialize, ctx => handleInitialize(ctx.params))
        .onRequest(AGENT_METHODS.session_new, ctx => handleNewSession(ctx.params))
        .onRequest(AGENT_METHODS.session_prompt, ctx =>
            handlePrompt(ctx.params, (sessionId, text) =>
                ctx.client.notify(CLIENT_METHODS.session_update, {
                    sessionId,
                    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
                }),
            ),
        )
        .onNotification(AGENT_METHODS.session_cancel, ctx => {
            handleCancel(ctx.params.sessionId)
        })
}

/** Test-only: sessions is module-level state (one ACP agent process = one
 *  map for its lifetime, same pattern as mcp-context.ts's cached manager) —
 *  tests need to reset it between runs. */
export function _resetSessionsForTest(): void {
    sessions.clear()
}
