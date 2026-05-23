// Anthropic Messages API protocol.
// Used only by: Anthropic (Claude models).

import type { Protocol } from "../protocol.ts"
import type { LLMRequest, LLMResponse, LLMEvent, Message } from "../schema.ts"

function toAnthropicMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
        if (typeof msg.content === "string") {
            return { role: msg.role, content: msg.content }
        }

        const content = msg.content.map((part) => {
            switch (part.type) {
                case "text":
                    return { type: "text", text: part.text }
                case "image":
                    return {
                        type: "image",
                        source:
                            part.source.type === "base64"
                                ? { type: "base64", media_type: part.source.mediaType, data: part.source.data }
                                : { type: "url", url: part.source.url },
                    }
                case "tool_call":
                    return { type: "tool_use", id: part.id, name: part.name, input: part.input }
                case "tool_result":
                    return {
                        type: "tool_result",
                        tool_use_id: part.toolCallId,
                        content: part.content,
                        is_error: part.isError ?? false,
                    }
            }
        })

        return { role: msg.role, content }
    })
}

export const anthropicMessages: Protocol = {
    name: "anthropic-messages",
    supportsStreaming: true,

    buildPath: () => "/messages",

    buildHeaders: (apiKey) => ({
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
    }),

    buildBody: (req) => ({
        model: req.model.id,
        messages: toAnthropicMessages(req.messages),
        ...(req.system ? { system: req.system } : {}),
        temperature: req.temperature ?? 0.3,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
        ...(req.tools?.length
            ? {
                  tools: req.tools.map((t) => ({
                      name: t.name,
                      description: t.description,
                      input_schema: t.parameters,
                  })),
              }
            : {}),
    }),

    parseChunk: (line) => {
        if (!line.startsWith("data: ")) return []
        const data = line.slice(6).trim()

        try {
            const parsed = JSON.parse(data) as Record<string, unknown>
            const eventType = parsed["type"] as string
            const events: LLMEvent[] = []

            switch (eventType) {
                case "message_start": {
                    const msg = parsed["message"] as Record<string, unknown> | undefined
                    const usage = msg?.["usage"] as Record<string, unknown> | undefined
                    if (usage) {
                        events.push({
                            type: "usage",
                            stats: {
                                inputTokens: Number(usage["input_tokens"] ?? 0),
                                outputTokens: 0,
                                cacheReadTokens: Number(usage["cache_read_input_tokens"] ?? 0) || undefined,
                                cacheWriteTokens:
                                    Number(usage["cache_creation_input_tokens"] ?? 0) || undefined,
                            },
                        })
                    }
                    break
                }
                case "content_block_start": {
                    const block = parsed["content_block"] as Record<string, unknown> | undefined
                    if (block?.["type"] === "tool_use") {
                        events.push({
                            type: "tool_call_start",
                            id: String(block["id"] ?? ""),
                            name: String(block["name"] ?? ""),
                        })
                    }
                    break
                }
                case "content_block_delta": {
                    const delta = parsed["delta"] as Record<string, unknown> | undefined
                    const index = Number(parsed["index"] ?? 0)
                    if (delta?.["type"] === "text_delta") {
                        events.push({ type: "text_delta", delta: String(delta["text"] ?? "") })
                    } else if (delta?.["type"] === "input_json_delta") {
                        events.push({
                            type: "tool_call_delta",
                            id: `block_${index}`,
                            inputDelta: String(delta["partial_json"] ?? ""),
                        })
                    }
                    break
                }
                case "content_block_stop": {
                    const index = Number(parsed["index"] ?? 0)
                    events.push({ type: "tool_call_end", id: `block_${index}` })
                    break
                }
                case "message_delta": {
                    const usage = parsed["usage"] as Record<string, unknown> | undefined
                    if (usage) {
                        events.push({
                            type: "usage",
                            stats: {
                                inputTokens: 0,
                                outputTokens: Number(usage["output_tokens"] ?? 0),
                            },
                        })
                    }
                    break
                }
            }

            return events
        } catch {
            return []
        }
    },

    parseFull: (raw) => {
        const r = raw as Record<string, unknown>
        let text = ""
        const toolCalls: LLMResponse["toolCalls"] = []

        for (const block of (r["content"] as Array<Record<string, unknown>>) ?? []) {
            if (block["type"] === "text") text += String(block["text"] ?? "")
            if (block["type"] === "tool_use") {
                toolCalls.push({
                    id: String(block["id"] ?? ""),
                    name: String(block["name"] ?? ""),
                    input: (block["input"] as Record<string, unknown>) ?? {},
                })
            }
        }

        const stopMap: Record<string, LLMResponse["stopReason"]> = {
            end_turn: "end",
            tool_use: "tool_use",
            max_tokens: "max_tokens",
            stop_sequence: "stop",
        }

        const usage = r["usage"] as Record<string, unknown> | undefined

        return {
            text,
            toolCalls,
            usage: {
                inputTokens: Number(usage?.["input_tokens"] ?? 0),
                outputTokens: Number(usage?.["output_tokens"] ?? 0),
                cacheReadTokens: Number(usage?.["cache_read_input_tokens"] ?? 0) || undefined,
                cacheWriteTokens: Number(usage?.["cache_creation_input_tokens"] ?? 0) || undefined,
            },
            stopReason: stopMap[String(r["stop_reason"] ?? "end_turn")] ?? "end",
        }
    },
}
