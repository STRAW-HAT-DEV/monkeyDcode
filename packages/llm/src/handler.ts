import type { LLMRequest, LLMResponse, LLMEvent } from "./schema.ts"

export interface LLMHandler {
    generate(req: LLMRequest): Promise<LLMResponse>
    stream(req: LLMRequest): AsyncIterable<LLMEvent>
}
