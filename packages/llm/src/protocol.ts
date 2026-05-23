// Interface Segregation Principle: two focused interfaces, combined into Protocol.
// RequestBuilder knows how to build an outgoing HTTP request.
// ResponseParser knows how to interpret what comes back.

import type { LLMRequest, LLMResponse, LLMEvent } from "./schema.ts"

export interface RequestBuilder {
    buildPath(modelId: string): string
    buildHeaders(apiKey: string): Record<string, string>
    buildBody(req: LLMRequest): Record<string, unknown>
}

export interface ResponseParser {
    // Called per SSE line during streaming
    parseChunk(line: string): LLMEvent[]
    // Called on the full JSON body for non-streaming responses
    parseFull(raw: unknown): LLMResponse
}

export interface Protocol extends RequestBuilder, ResponseParser {
    readonly name: string
    readonly supportsStreaming: boolean
}
