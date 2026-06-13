// @ts-nocheck
/**
 * Bridge between monkeyDcode TUI/agents and the full opencode session stack.
 */
import { Effect } from "effect"
import { AppRuntime } from "../effect/app-runtime.ts"
import { InstanceStore } from "../project/instance-store.ts"
import { Session } from "./session.ts"
import { SessionPrompt } from "./prompt.ts"
import { MessageV2 } from "./message-v2.ts"
import { SessionID, MessageID, PartID } from "./schema.ts"
import type { ModelRef as LlmModelRef } from "@monkeydcode/llm"
import { ProviderID, ModelID } from "../provider/schema.ts"

export interface MdcBridgeSession {
    id: string
    directory: string
    engine: boolean
}

let _cached: MdcBridgeSession | null = null

function toEngineModel(model: LlmModelRef) {
    return {
        providerID: ProviderID.make(model.provider),
        modelID: ModelID.make(model.id),
    }
}

function runInInstance<A>(directory: string, effect: Effect.Effect<A, unknown, never>) {
    return AppRuntime.runPromise(
        InstanceStore.Service.use(store => store.provide({ directory }, effect)),
    )
}

/** Create or reuse an opencode session for the project directory. */
export async function init(directory: string): Promise<MdcBridgeSession> {
    if (_cached?.directory === directory && _cached.engine) return _cached

    try {
        const session = await runInInstance(
            directory,
            Effect.gen(function* () {
                const svc = yield* Session.Service
                return yield* svc.create({ title: "monkeyDcode" })
            }),
        )
        _cached = { id: session.id, directory, engine: true }
        return _cached
    } catch (e) {
        console.warn("[mdc-bridge] Engine session unavailable:", e instanceof Error ? e.message : e)
        _cached = { id: "", directory, engine: false }
        return _cached
    }
}

/** Persist user message via SessionPrompt (no LLM reply). */
export async function appendUserMessage(
    directory: string,
    sessionId: string,
    text: string,
    model?: LlmModelRef,
): Promise<void> {
    const bridge = await init(directory)
    if (!bridge.engine || !sessionId) return

    try {
        await runInInstance(
            directory,
            Effect.gen(function* () {
                const prompt = yield* SessionPrompt.Service
                yield* prompt.prompt({
                    sessionID: sessionId as SessionID,
                    parts: [{ type: "text", text }],
                    noReply: true,
                    ...(model ? { model: toEngineModel(model) } : {}),
                })
            }),
        )
    } catch { /* graceful fallback to Runner-only persistence */ }
}

/** Persist assistant summary via Session.updateMessage + text part. */
export async function appendAssistantMessage(
    directory: string,
    sessionId: string,
    text: string,
): Promise<void> {
    const bridge = await init(directory)
    if (!bridge.engine || !sessionId) return

    try {
        await runInInstance(
            directory,
            Effect.gen(function* () {
                const sessions = yield* Session.Service
                const msg: MessageV2.Assistant = {
                    id: MessageID.ascending(),
                    role: "assistant",
                    sessionID: sessionId as SessionID,
                    time: { created: Date.now() },
                    parentID: MessageID.ascending(),
                    modelID: ModelID.make("unknown"),
                    providerID: ProviderID.make("ollama"),
                    agent: "build",
                    mode: "build",
                    path: { cwd: directory, root: directory },
                    cost: 0,
                    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                }
                yield* sessions.updateMessage(msg)
                yield* sessions.updatePart({
                    id: PartID.ascending(),
                    type: "text",
                    text,
                    sessionID: sessionId as SessionID,
                    messageID: msg.id,
                })
            }),
        )
    } catch { /* graceful fallback */ }
}

/** Run through full SessionPrompt processor (LLM + tools). */
export async function processWithEngine(
    directory: string,
    sessionId: string,
    text: string,
    model: LlmModelRef,
): Promise<string> {
    const result = await runInInstance(
        directory,
        Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            return yield* prompt.prompt({
                sessionID: sessionId as SessionID,
                model: toEngineModel(model),
                parts: [{ type: "text", text }],
            })
        }),
    )
    return result.parts
        .filter((p): p is MessageV2.TextPart => p.type === "text")
        .map(p => p.text)
        .join("")
}

export const MdcBridge = {
    init,
    appendUserMessage,
    appendAssistantMessage,
    processWithEngine,
}
