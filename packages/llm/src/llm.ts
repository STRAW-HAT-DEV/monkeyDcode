// Public LLM API.
// generate() → Effect (single response, collects stream internally)
// stream()   → AsyncIterable (live token-by-token events)
// All serialization uses JSON throughout.

import { Effect } from "effect"
import type { LLMRequest, LLMResponse, LLMEvent, UsageStats } from "./schema.ts"
import { LLMError } from "./error.ts"
import { RouteRegistry } from "./route-registry.ts"
import type { Route } from "./route.ts"

async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
                if (line.trim()) yield line
            }
        }
        if (buffer.trim()) yield buffer
    } finally {
        reader.releaseLock()
    }
}

function resolveRoute(req: LLMRequest): Route {
    const route = RouteRegistry.get(req.model.provider)
    if (!route) {
        throw new LLMError(
            `No route registered for provider "${req.model.provider}". Did you import the provider?`,
            "model_not_found",
            req.model.provider,
        )
    }
    return route
}

async function doFetch(route: Route, req: LLMRequest): Promise<Response> {
    const { protocol, baseUrl, apiKey, defaultHeaders = {} } = route.config
    const key = apiKey() ?? ""
    const url = `${baseUrl}${protocol.buildPath(req.model.id)}`
    const headers = { ...defaultHeaders, ...protocol.buildHeaders(key) }
    const body = JSON.stringify(protocol.buildBody(req))

    const res = await fetch(url, { method: "POST", headers, body })

    if (!res.ok) {
        const text = await res.text().catch(() => `HTTP ${res.status}`)
        throw new LLMError(
            `${req.model.provider}: HTTP ${res.status} — ${text}`,
            res.status === 401 ? "auth_failed" : res.status === 429 ? "rate_limited" : "unknown",
            req.model.provider,
            res.status,
        )
    }

    return res
}

function buildResponseFromEvents(events: LLMEvent[]): LLMResponse {
    let text = ""
    const toolBuilders: Record<string, { name: string; inputJson: string }> = {}
    const usage: UsageStats = { inputTokens: 0, outputTokens: 0 }

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
                usage.inputTokens += event.stats.inputTokens
                usage.outputTokens += event.stats.outputTokens
                if (event.stats.cacheReadTokens) usage.cacheReadTokens = event.stats.cacheReadTokens
                if (event.stats.cacheWriteTokens) usage.cacheWriteTokens = event.stats.cacheWriteTokens
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
        usage,
        stopReason: toolCalls.length > 0 ? "tool_use" : "end",
    }
}

export const LLM = {
    generate(req: LLMRequest): Effect.Effect<LLMResponse, LLMError> {
        return Effect.tryPromise({
            try: async () => {
                const route = resolveRoute(req)
                const res = await doFetch(route, req)
                const events: LLMEvent[] = []
                for await (const line of readLines(res.body!)) {
                    events.push(...route.config.protocol.parseChunk(line))
                }
                return buildResponseFromEvents(events)
            },
            catch: (e: unknown) => LLMError.from(e, req.model.provider),
        })
    },

    // Promise-based API — no Effect import needed in consuming code.
    async generateAsync(req: LLMRequest): Promise<LLMResponse> {
        const route = resolveRoute(req)
        const res = await doFetch(route, req)
        const events: LLMEvent[] = []
        for await (const line of readLines(res.body!)) {
            events.push(...route.config.protocol.parseChunk(line))
        }
        return buildResponseFromEvents(events)
    },

    async *stream(req: LLMRequest): AsyncIterable<LLMEvent> {
        const route = resolveRoute(req)
        let res: Response
        try {
            res = await doFetch(route, req)
        } catch (e) {
            yield { type: "error", error: LLMError.from(e, req.model.provider) }
            return
        }

        const events: LLMEvent[] = []

        for await (const line of readLines(res.body!)) {
            const chunk = route.config.protocol.parseChunk(line)
            for (const event of chunk) {
                events.push(event)
                yield event
            }
        }

        yield { type: "done", response: buildResponseFromEvents(events) }
    },
}
