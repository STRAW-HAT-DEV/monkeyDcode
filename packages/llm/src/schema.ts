// Core types for the LLM package.
// Conversion to/from JSON happens only inside protocol implementations.

export type Role = "user" | "assistant" | "system" | "tool"

export interface TextPart {
    type: "text"
    text: string
}

export interface ImagePart {
    type: "image"
    source:
        | { type: "base64"; mediaType: string; data: string }
        | { type: "url"; url: string }
}

export interface ToolCallPart {
    type: "tool_call"
    id: string
    name: string
    input: Record<string, unknown>
}

export interface ToolResultPart {
    type: "tool_result"
    toolCallId: string
    content: string
    isError?: boolean
}

export type ContentPart = TextPart | ImagePart | ToolCallPart | ToolResultPart

export interface Message {
    role: Role
    content: string | ContentPart[]
}

export interface ToolDefinition {
    name: string
    description: string
    parameters: Record<string, unknown>
}

export interface ModelRef {
    readonly provider: string
    readonly id: string
    readonly label?: string
}

export interface LLMRequest {
    model: ModelRef
    messages: Message[]
    system?: string
    tools?: ToolDefinition[]
    temperature?: number
    maxTokens?: number
}

export interface UsageStats {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
}

export type StopReason = "end" | "tool_use" | "max_tokens" | "stop"

export interface LLMResponse {
    text: string
    toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>
    usage: UsageStats
    stopReason: StopReason
}

// Discriminated union — all event types across providers and reasoning models
export type LLMEvent =
    // Core streaming
    | { type: "text_delta"; delta: string }
    | { type: "tool_call_start"; id: string; name: string }
    | { type: "tool_call_delta"; id: string; inputDelta: string }
    | { type: "tool_call_end"; id: string }
    | { type: "usage"; stats: UsageStats }
    | { type: "done"; response: LLMResponse }
    | { type: "error"; error: LLMError }
    // Extended thinking / reasoning (Claude, o1, o3, DeepSeek-R1)
    | { type: "reasoning-start" }
    | { type: "reasoning-delta"; delta: string }
    | { type: "reasoning-end"; text: string }
    // Tool lifecycle (full cycle)
    | { type: "tool-input-start"; id: string; name: string }
    | { type: "tool-input-delta"; id: string; inputDelta: string }
    | { type: "tool-input-end"; id: string; input: Record<string, unknown> }
    | { type: "tool-call"; id: string; name: string; input: Record<string, unknown> }
    | { type: "tool-result"; id: string; result: unknown }
    | { type: "tool-error"; id: string; error: unknown }
    // Multi-step / agent loop
    | { type: "step-start"; stepIndex: number }
    | { type: "step-finish"; stepIndex: number; usage: UsageStats; stopReason: StopReason }
    | { type: "provider-error"; message: string; code?: string }

// Avoid circular import — define inline here, full class in error.ts
import type { LLMError } from "./error.ts"
