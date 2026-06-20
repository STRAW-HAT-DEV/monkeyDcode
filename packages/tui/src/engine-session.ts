import type { ModelRef } from "@monkeydcode/llm"
import { MdcBridge } from "@monkeydcode/engine/session/mdc-bridge"

export async function initEngineSession(directory: string) {
    return MdcBridge.init(directory)
}

export async function logUserToEngine(
    directory: string,
    sessionId: string,
    text: string,
    model?: ModelRef,
) {
    return MdcBridge.appendUserMessage(directory, sessionId, text, model)
}

export async function logAssistantToEngine(directory: string, sessionId: string, text: string) {
    return MdcBridge.appendAssistantMessage(directory, sessionId, text)
}

/** Full opencode SessionPrompt path (LLM + engine tools). Used for echo mode. */
export async function processWithEngine(
    directory: string,
    sessionId: string,
    text: string,
    model: ModelRef,
) {
    return MdcBridge.processWithEngine(directory, sessionId, text, model)
}
