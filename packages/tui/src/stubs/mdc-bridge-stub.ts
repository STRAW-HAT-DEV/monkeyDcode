/** Typecheck stub — runtime uses real @monkeydcode/engine/session/mdc-bridge */
import type { ModelRef } from "@monkeydcode/llm"

export interface MdcBridgeSession {
    id: string
    directory: string
    engine: boolean
}

export const MdcBridge = {
    init: async (directory: string): Promise<MdcBridgeSession> =>
        ({ id: "", directory, engine: false }),
    appendUserMessage: async (_d: string, _s: string, _t: string, _m?: ModelRef) => {},
    appendAssistantMessage: async (_d: string, _s: string, _t: string) => {},
    processWithEngine: async (_d: string, _s: string, text: string, _m?: ModelRef) => text,
}
