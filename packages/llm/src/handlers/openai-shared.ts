// Shared OpenAI message conversion helpers.
// Used by both openai-sdk.ts (native OpenAI) and openai-compat-sdk.ts (Groq, DeepSeek, etc.).

import type OpenAI from "openai"
import type { LLMRequest, LLMResponse, LLMEvent, Message } from "../schema.ts"

export function toOpenAIMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.ChatCompletionMessageParam[] = []

    for (const msg of messages) {
        // String content — pass through directly
        if (typeof msg.content === "string") {
            if (msg.role === "assistant") {
                result.push({ role: "assistant", content: msg.content })
            } else if (msg.role === "system") {
                result.push({ role: "system", content: msg.content })
            } else {
                result.push({ role: "user", content: msg.content })
            }
            continue
        }

        // Tool result parts become individual tool-role messages
        const toolResults = msg.content.filter((p) => p.type === "tool_result")
        if (toolResults.length > 0) {
            for (const p of toolResults) {
                if (p.type !== "tool_result") continue
                result.push({ role: "tool", tool_call_id: p.toolCallId, content: p.content })
            }
            continue
        }

        // Build structured content array for user messages (text + images).
        // For assistant messages with tool_calls, collect text-only content and tool_call parts.
        // Tool call parts in assistant messages are surfaced as tool_calls on the message,
        // not as content parts, so they are handled separately below.
        const userContentParts: OpenAI.Chat.ChatCompletionContentPart[] = []
        const assistantTextParts: OpenAI.Chat.ChatCompletionContentPartText[] = []
        const toolCallParts: OpenAI.Chat.ChatCompletionMessageToolCall[] = []

        for (const part of msg.content) {
            switch (part.type) {
                case "text":
                    userContentParts.push({ type: "text", text: part.text })
                    assistantTextParts.push({ type: "text", text: part.text })
                    break
                case "image":
                    userContentParts.push({
                        type: "image_url",
                        image_url: {
                            url:
                                part.source.type === "url"
                                    ? part.source.url
                                    : `data:${part.source.mediaType};base64,${part.source.data}`,
                        },
                    })
                    break
                case "tool_call":
                    toolCallParts.push({
                        id: part.id,
                        type: "function",
                        function: {
                            name: part.name,
                            arguments: JSON.stringify(part.input),
                        },
                    })
                    break
                default:
                    break
            }
        }

        if (msg.role === "assistant") {
            if (toolCallParts.length > 0) {
                result.push({
                    role: "assistant",
                    content: assistantTextParts.length > 0 ? assistantTextParts : null,
                    tool_calls: toolCallParts,
                })
            } else {
                result.push({
                    role: "assistant",
                    content: assistantTextParts.length > 0 ? assistantTextParts : null,
                })
            }
        } else if (msg.role === "system") {
            // System messages only support string content; join text parts
            const text = assistantTextParts.map((p) => p.text).join("\n")
            result.push({ role: "system", content: text })
        } else {
            result.push({ role: "user", content: userContentParts })
        }
    }

    return result
}

export function buildTools(
    tools: LLMRequest["tools"],
): OpenAI.Chat.ChatCompletionTool[] | undefined {
    if (!tools?.length) return undefined
    return tools.map((t) => ({
        type: "function" as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters as Record<string, unknown>,
        },
    }))
}

export function buildResponseFromEvents(events: LLMEvent[]): LLMResponse {
    let text = ""
    const toolBuilders: Record<string, { name: string; inputJson: string }> = {}
    let inputTokens = 0
    let outputTokens = 0

    for (const event of events) {
        switch (event.type) {
            case "text_delta":
                text += event.delta
                break
            case "tool_call_start":
                toolBuilders[event.id] = { name: event.name, inputJson: "" }
                break
            case "tool_call_delta": {
                const b = toolBuilders[event.id]
                if (b) b.inputJson += event.inputDelta
                break
            }
            case "usage":
                inputTokens += event.stats.inputTokens
                outputTokens += event.stats.outputTokens
                break
        }
    }

    const toolCalls = Object.entries(toolBuilders).map(([id, { name, inputJson }]) => ({
        id,
        name,
        input: inputJson ? (JSON.parse(inputJson) as Record<string, unknown>) : {},
    }))

    return {
        text,
        toolCalls,
        usage: { inputTokens, outputTokens },
        stopReason: toolCalls.length > 0 ? "tool_use" : "end",
    }
}

export const FINISH_REASON_MAP: Record<string, LLMResponse["stopReason"]> = {
    stop: "end",
    tool_calls: "tool_use",
    length: "max_tokens",
}
