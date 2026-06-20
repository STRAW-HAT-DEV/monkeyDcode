// Anthropic Messages API SDK handler — uses @anthropic-ai/sdk.
import Anthropic from "@anthropic-ai/sdk"
import type { LLMHandler } from "../handler.ts"
import type { LLMRequest, LLMResponse, LLMEvent, Message } from "../schema.ts"
import { LLMRuntime } from "../runtime.ts"

const ANTHROPIC_BASE_URL = "https://api.anthropic.com"

function getClient(): Anthropic {
    const apiKey = LLMRuntime.getApiKey("anthropic", () => process.env["ANTHROPIC_API_KEY"]) ?? ""
    const baseURL = LLMRuntime.getBaseUrl("anthropic", ANTHROPIC_BASE_URL)
    return new Anthropic({
        apiKey,
        baseURL,
        defaultHeaders: {
            "anthropic-beta": "prompt-caching-2024-07-31",
        },
    })
}

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = []

    for (const msg of messages) {
        // Skip system messages — handled via the top-level `system` param
        if (msg.role === "system") continue

        if (typeof msg.content === "string") {
            // tool role doesn't exist in Anthropic — treat as user
            const role = msg.role === "tool" ? "user" : msg.role
            result.push({ role, content: msg.content })
            continue
        }

        const blocks: Anthropic.ContentBlockParam[] = []

        for (const part of msg.content) {
            if (part.type === "text") {
                blocks.push({ type: "text", text: part.text })
            } else if (part.type === "image") {
                if (part.source.type === "base64") {
                    blocks.push({
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: part.source.mediaType as Anthropic.Base64ImageSource["media_type"],
                            data: part.source.data,
                        },
                    })
                } else {
                    blocks.push({
                        type: "image",
                        source: {
                            type: "url",
                            url: part.source.url,
                        },
                    })
                }
            } else if (part.type === "tool_call") {
                blocks.push({
                    type: "tool_use",
                    id: part.id,
                    name: part.name,
                    input: part.input,
                })
            } else if (part.type === "tool_result") {
                // tool_result parts must be in "user" role — flush current blocks first if needed
                if (blocks.length > 0) {
                    const role = msg.role === "tool" || msg.role === "user" ? "user" : "assistant"
                    result.push({ role, content: blocks.splice(0) })
                }
                result.push({
                    role: "user",
                    content: [
                        {
                            type: "tool_result",
                            tool_use_id: part.toolCallId,
                            content: part.content,
                            is_error: part.isError ?? false,
                        },
                    ],
                })
            }
        }

        if (blocks.length > 0) {
            // Anthropic doesn't have a "tool" role — tool result content was already pushed above
            const role = msg.role === "tool" ? "user" : msg.role
            result.push({ role, content: blocks })
        }
    }

    return result
}

function toAnthropicTools(tools: LLMRequest["tools"]): Anthropic.Tool[] | undefined {
    if (!tools?.length) return undefined
    return tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Anthropic.Tool["input_schema"],
    }))
}

const STOP_REASON_MAP: Record<string, LLMResponse["stopReason"]> = {
    end_turn: "end",
    tool_use: "tool_use",
    max_tokens: "max_tokens",
    stop_sequence: "stop",
}

export function makeAnthropicHandler(): LLMHandler {
    return {
        async generate(req: LLMRequest): Promise<LLMResponse> {
            const client = getClient()
            const tools = toAnthropicTools(req.tools)

            const response = await client.messages.create({
                model: req.model.id,
                messages: toAnthropicMessages(req.messages),
                ...(req.system ? { system: req.system } : {}),
                max_tokens: req.maxTokens ?? 4096,
                temperature: req.temperature ?? 0.3,
                ...(tools ? { tools } : {}),
            })

            let text = ""
            const toolCalls: LLMResponse["toolCalls"] = []

            for (const block of response.content) {
                if (block.type === "text") text += block.text
                if (block.type === "tool_use") {
                    toolCalls.push({
                        id: block.id,
                        name: block.name,
                        input: block.input as Record<string, unknown>,
                    })
                }
            }

            const rawUsage = response.usage as unknown as Record<string, unknown>

            return {
                text,
                toolCalls,
                usage: {
                    inputTokens: response.usage.input_tokens,
                    outputTokens: response.usage.output_tokens,
                    cacheReadTokens: rawUsage["cache_read_input_tokens"] as number | undefined,
                    cacheWriteTokens: rawUsage["cache_creation_input_tokens"] as number | undefined,
                },
                stopReason: STOP_REASON_MAP[response.stop_reason ?? "end_turn"] ?? "end",
            }
        },

        async *stream(req: LLMRequest): AsyncIterable<LLMEvent> {
            const client = getClient()
            const tools = toAnthropicTools(req.tools)

            const stream = await client.messages.create({
                model: req.model.id,
                messages: toAnthropicMessages(req.messages),
                ...(req.system ? { system: req.system } : {}),
                max_tokens: req.maxTokens ?? 4096,
                temperature: req.temperature ?? 0.3,
                stream: true,
                ...(tools ? { tools } : {}),
            })

            const accumulated: LLMEvent[] = []

            for await (const event of stream) {
                switch (event.type) {
                    case "message_start": {
                        const rawUsage = event.message.usage as unknown as Record<string, unknown>
                        const ev: LLMEvent = {
                            type: "usage",
                            stats: {
                                inputTokens: event.message.usage.input_tokens,
                                outputTokens: 0,
                                cacheReadTokens: rawUsage["cache_read_input_tokens"] as number | undefined,
                                cacheWriteTokens: rawUsage["cache_creation_input_tokens"] as number | undefined,
                            },
                        }
                        accumulated.push(ev)
                        yield ev
                        break
                    }
                    case "content_block_start": {
                        if (event.content_block.type === "tool_use") {
                            const ev: LLMEvent = {
                                type: "tool_call_start",
                                id: event.content_block.id,
                                name: event.content_block.name,
                            }
                            accumulated.push(ev)
                            yield ev
                        }
                        break
                    }
                    case "content_block_delta": {
                        if (event.delta.type === "text_delta") {
                            const ev: LLMEvent = { type: "text_delta", delta: event.delta.text }
                            accumulated.push(ev)
                            yield ev
                        } else if (event.delta.type === "input_json_delta") {
                            const ev: LLMEvent = {
                                type: "tool_call_delta",
                                id: `block_${event.index}`,
                                inputDelta: event.delta.partial_json,
                            }
                            accumulated.push(ev)
                            yield ev
                        }
                        break
                    }
                    case "content_block_stop": {
                        const ev: LLMEvent = { type: "tool_call_end", id: `block_${event.index}` }
                        accumulated.push(ev)
                        yield ev
                        break
                    }
                    case "message_delta": {
                        const ev: LLMEvent = {
                            type: "usage",
                            stats: {
                                inputTokens: 0,
                                outputTokens: event.usage.output_tokens,
                            },
                        }
                        accumulated.push(ev)
                        yield ev
                        break
                    }
                }
            }

            yield { type: "done", response: buildResponseFromEvents(accumulated) }
        },
    }
}

function buildResponseFromEvents(events: LLMEvent[]): LLMResponse {
    let text = ""
    const toolBuilders: Record<string, { name: string; inputJson: string }> = {}
    const usage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: undefined as number | undefined,
        cacheWriteTokens: undefined as number | undefined,
    }

    for (const event of events) {
        if (event.type === "text_delta") {
            text += event.delta
        } else if (event.type === "tool_call_start") {
            toolBuilders[event.id] = { name: event.name, inputJson: "" }
        } else if (event.type === "tool_call_delta") {
            const builder = toolBuilders[event.id]
            if (builder) builder.inputJson += event.inputDelta
        } else if (event.type === "usage") {
            usage.inputTokens += event.stats.inputTokens
            usage.outputTokens += event.stats.outputTokens
            if (event.stats.cacheReadTokens !== undefined) {
                usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + event.stats.cacheReadTokens
            }
            if (event.stats.cacheWriteTokens !== undefined) {
                usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + event.stats.cacheWriteTokens
            }
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
        usage,
        stopReason: toolCalls.length > 0 ? "tool_use" : "end",
    }
}
