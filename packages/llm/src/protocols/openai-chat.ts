// OpenAI Chat Completions protocol.
// Used by: OpenAI, Ollama, DeepSeek, OpenRouter — they all speak this format.

import type { Protocol } from "../protocol.ts"
import type { LLMRequest, LLMResponse, LLMEvent, Message } from "../schema.ts"

function toOpenAIMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
        if (typeof msg.content === "string") {
            return { role: msg.role, content: msg.content }
        }

        const toolResults = msg.content.filter((p) => p.type === "tool_result")
        if (toolResults.length > 0) {
            return toolResults.map((p) => {
                if (p.type !== "tool_result") return null
                return { role: "tool", tool_call_id: p.toolCallId, content: p.content }
            })
        }

        const content = msg.content.map((part) => {
            switch (part.type) {
                case "text":
                    return { type: "text", text: part.text }
                case "image":
                    return {
                        type: "image_url",
                        image_url: {
                            url:
                                part.source.type === "url"
                                    ? part.source.url
                                    : `data:${part.source.mediaType};base64,${part.source.data}`,
                        },
                    }
                case "tool_call":
                    return null
                default:
                    return null
            }
        }).filter(Boolean)

        return { role: msg.role, content }
    }).flat()
}

export const openAIChat: Protocol = {
    name: "openai-chat",
    supportsStreaming: true,

    buildPath: () => "/chat/completions",

    buildHeaders: (apiKey) => ({
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
    }),

    buildBody: (req) => ({
        model: req.model.id,
        messages: toOpenAIMessages(req.messages),
        ...(req.system
            ? { messages: [{ role: "system", content: req.system }, ...toOpenAIMessages(req.messages)] }
            : {}),
        temperature: req.temperature ?? 0.3,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true },
        ...(req.tools?.length
            ? {
                  tools: req.tools.map((t) => ({
                      type: "function",
                      function: { name: t.name, description: t.description, parameters: t.parameters },
                  })),
              }
            : {}),
    }),

    parseChunk: (line) => {
        if (!line.startsWith("data: ")) return []
        const data = line.slice(6).trim()
        if (data === "[DONE]") return []

        try {
            const parsed = JSON.parse(data) as Record<string, unknown>
            const choices = parsed["choices"] as Array<Record<string, unknown>> | undefined
            const choice = choices?.[0]
            if (!choice) return []

            const delta = choice["delta"] as Record<string, unknown>
            const events: LLMEvent[] = []

            if (typeof delta["content"] === "string" && delta["content"]) {
                events.push({ type: "text_delta", delta: delta["content"] })
            }

            const toolCalls = delta["tool_calls"] as Array<Record<string, unknown>> | undefined
            if (toolCalls) {
                for (const tc of toolCalls) {
                    const fn = tc["function"] as Record<string, unknown> | undefined
                    if (fn?.["name"]) {
                        events.push({ type: "tool_call_start", id: String(tc["id"] ?? ""), name: String(fn["name"]) })
                    }
                    if (fn?.["arguments"]) {
                        events.push({
                            type: "tool_call_delta",
                            id: String(tc["id"] ?? ""),
                            inputDelta: String(fn["arguments"]),
                        })
                    }
                }
            }

            const usage = parsed["usage"] as Record<string, unknown> | undefined
            if (usage) {
                events.push({
                    type: "usage",
                    stats: {
                        inputTokens: Number(usage["prompt_tokens"] ?? 0),
                        outputTokens: Number(usage["completion_tokens"] ?? 0),
                    },
                })
            }

            return events
        } catch {
            return []
        }
    },

    parseFull: (raw) => {
        const r = raw as Record<string, unknown>
        const choices = r["choices"] as Array<Record<string, unknown>> | undefined
        const choice = choices?.[0]
        const msg = choice?.["message"] as Record<string, unknown> | undefined

        const rawToolCalls = (msg?.["tool_calls"] as Array<Record<string, unknown>> | undefined) ?? []
        const toolCalls = rawToolCalls.map((tc) => {
            const fn = tc["function"] as Record<string, unknown>
            return {
                id: String(tc["id"] ?? ""),
                name: String(fn["name"] ?? ""),
                input: JSON.parse(String(fn["arguments"] ?? "{}")),
            }
        })

        const finishReason = String(choice?.["finish_reason"] ?? "stop")
        const stopMap: Record<string, LLMResponse["stopReason"]> = {
            stop: "end",
            tool_calls: "tool_use",
            length: "max_tokens",
        }

        const usage = r["usage"] as Record<string, unknown> | undefined

        return {
            text: String(msg?.["content"] ?? ""),
            toolCalls,
            usage: {
                inputTokens: Number(usage?.["prompt_tokens"] ?? 0),
                outputTokens: Number(usage?.["completion_tokens"] ?? 0),
            },
            stopReason: stopMap[finishReason] ?? "end",
        }
    },
}
