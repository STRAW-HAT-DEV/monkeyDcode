// OpenAI-compatible SDK handler for third-party providers.
// Uses max_tokens (not max_completion_tokens) — Groq, DeepSeek, OpenRouter, and Ollama
// follow the original OpenAI Chat Completions spec and do not support max_completion_tokens.

import OpenAI from "openai"
import type { LLMHandler } from "../handler.ts"
import type { LLMRequest, LLMResponse, LLMEvent } from "../schema.ts"
import { LLMRuntime } from "../runtime.ts"
import { toOpenAIMessages, buildTools, buildResponseFromEvents, FINISH_REASON_MAP } from "./openai-shared.ts"

export interface OpenAICompatOptions {
    /** Extra headers to merge into every request (e.g. HTTP-Referer for OpenRouter). */
    defaultHeaders?: Record<string, string>
}

function getClient(
    provider: string,
    defaultBaseUrl: string,
    defaultApiKey: string | undefined,
    options: OpenAICompatOptions,
): OpenAI {
    const apiKey =
        LLMRuntime.getApiKey(provider, () => defaultApiKey ?? process.env[`${provider.toUpperCase()}_API_KEY`]) ?? ""
    const baseURL = LLMRuntime.getBaseUrl(provider, defaultBaseUrl)
    return new OpenAI({ apiKey, baseURL, defaultHeaders: options.defaultHeaders })
}

function buildMessages(
    req: LLMRequest,
): OpenAI.Chat.ChatCompletionMessageParam[] {
    const converted = toOpenAIMessages(req.messages)
    if (req.system) {
        return [{ role: "system", content: req.system }, ...converted]
    }
    return converted
}

export function makeOpenAICompatHandler(
    provider: string,
    defaultBaseUrl: string,
    defaultApiKey?: string,
    options: OpenAICompatOptions = {},
): LLMHandler {
    return {
        async generate(req: LLMRequest): Promise<LLMResponse> {
            const client = getClient(provider, defaultBaseUrl, defaultApiKey, options)
            const tools = buildTools(req.tools)

            const response = await client.chat.completions.create({
                model: req.model.id,
                messages: buildMessages(req),
                temperature: req.temperature ?? 0.3,
                max_tokens: req.maxTokens ?? 4096,
                stream: false,
                ...(tools ? { tools } : {}),
            })

            const choice = response.choices[0]
            const msg = choice?.message

            const toolCalls = (msg?.tool_calls ?? []).map((tc) => ({
                id: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
            }))

            return {
                text: msg?.content ?? "",
                toolCalls,
                usage: {
                    inputTokens: response.usage?.prompt_tokens ?? 0,
                    outputTokens: response.usage?.completion_tokens ?? 0,
                },
                stopReason: FINISH_REASON_MAP[choice?.finish_reason ?? "stop"] ?? "end",
            }
        },

        async *stream(req: LLMRequest): AsyncIterable<LLMEvent> {
            const client = getClient(provider, defaultBaseUrl, defaultApiKey, options)
            const tools = buildTools(req.tools)

            const stream = await client.chat.completions.create({
                model: req.model.id,
                messages: buildMessages(req),
                temperature: req.temperature ?? 0.3,
                max_tokens: req.maxTokens ?? 4096,
                stream: true,
                stream_options: { include_usage: true },
                ...(tools ? { tools } : {}),
            })

            const events: LLMEvent[] = []

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta

                if (delta?.content) {
                    const ev: LLMEvent = { type: "text_delta", delta: delta.content }
                    events.push(ev)
                    yield ev
                }

                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        if (tc.function?.name) {
                            const ev: LLMEvent = {
                                type: "tool_call_start",
                                id: tc.id ?? "",
                                name: tc.function.name,
                            }
                            events.push(ev)
                            yield ev
                        }
                        if (tc.function?.arguments) {
                            const ev: LLMEvent = {
                                type: "tool_call_delta",
                                id: tc.id ?? "",
                                inputDelta: tc.function.arguments,
                            }
                            events.push(ev)
                            yield ev
                        }
                    }
                }

                if (chunk.usage) {
                    const ev: LLMEvent = {
                        type: "usage",
                        stats: {
                            inputTokens: chunk.usage.prompt_tokens,
                            outputTokens: chunk.usage.completion_tokens,
                        },
                    }
                    events.push(ev)
                    yield ev
                }
            }

            yield { type: "done", response: buildResponseFromEvents(events) }
        },
    }
}
