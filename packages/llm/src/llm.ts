// Public LLM API.
// generate() → Effect (single response, collects stream internally)
// stream()   → AsyncIterable (live token-by-token events)
// All serialization uses JSON throughout.

import { Effect } from "effect"
import type { LLMRequest, LLMResponse, LLMEvent, UsageStats } from "./schema.ts"
import { LLMError } from "./error.ts"
import { RouteRegistry } from "./route-registry.ts"
import type { Route } from "./route.ts"
import { LLMRuntime } from "./runtime.ts"

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

// Generous default so slow local models can finish; 0 disables the timeout.
// Override with MDCODE_LLM_TIMEOUT_MS.
const DEFAULT_LLM_TIMEOUT_MS = 600_000

function resolveTimeoutMs(): number {
    const raw = process.env.MDCODE_LLM_TIMEOUT_MS
    if (raw === undefined) return DEFAULT_LLM_TIMEOUT_MS
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_LLM_TIMEOUT_MS
}

function isTimeoutError(e: unknown): boolean {
    if (e instanceof DOMException && e.name === "TimeoutError") return true
    if (e instanceof Error) {
        return e.name === "TimeoutError" || /timed out|timeout|ETIMEDOUT/i.test(e.message)
    }
    return false
}

async function doFetch(route: Route, req: LLMRequest): Promise<Response> {
    const { protocol, baseUrl, apiKey, defaultHeaders = {} } = route.config
    const resolvedBase = LLMRuntime.getBaseUrl(route.provider, baseUrl)
    const key = LLMRuntime.getApiKey(route.provider, apiKey) ?? ""
    const url = `${resolvedBase}${protocol.buildPath(req.model.id)}`
    const headers = { ...defaultHeaders, ...protocol.buildHeaders(key) }
    const body = JSON.stringify(protocol.buildBody(req))

    const timeoutMs = resolveTimeoutMs()
    const signal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined

    let res: Response
    try {
        res = await fetch(url, { method: "POST", headers, body, signal })
    } catch (e) {
        if (isTimeoutError(e)) {
            throw new LLMError(
                `${req.model.provider}: request timed out after ${timeoutMs}ms. ` +
                    `The model may be too slow for this task — try a smaller/faster model, ` +
                    `or raise the limit with MDCODE_LLM_TIMEOUT_MS.`,
                "timeout",
                req.model.provider,
                undefined,
                e,
            )
        }
        throw new LLMError(
            `${req.model.provider}: network error — ${e instanceof Error ? e.message : String(e)}`,
            "network_error",
            req.model.provider,
            undefined,
            e,
        )
    }

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

// ─── Transient-error retry ─────────────────────────────────────────────────────
// Local model servers (e.g. Ollama) can drop the connection mid-generation
// (ECONNRESET) or stall. Retry these transient failures with backoff so a single
// flaky response doesn't abort the whole task. Deterministic failures (auth,
// model-not-found, bad request) are NOT retried.

const TRANSIENT_CODES: ReadonlySet<string> = new Set(["network_error", "timeout", "rate_limited"])

function maxRetries(): number {
    const raw = process.env.MDCODE_LLM_MAX_RETRIES
    if (raw === undefined) return 2
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2
}

function isTransient(e: unknown): boolean {
    if (e instanceof LLMError) return TRANSIENT_CODES.has(e.code)
    const msg = e instanceof Error ? e.message : String(e)
    return /ECONNRESET|socket connection was closed|ETIMEDOUT|EPIPE|ECONNREFUSED|fetch failed|timed out/i.test(msg)
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function withRetry<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    const retries = maxRetries()
    let lastErr: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn()
        } catch (e) {
            lastErr = e
            if (!isTransient(e) || attempt === retries) {
                throw e instanceof LLMError ? e : LLMError.from(e, provider)
            }
            await delay(Math.min(1000 * 2 ** attempt, 8000))
        }
    }
    throw lastErr instanceof LLMError ? lastErr : LLMError.from(lastErr, provider)
}

async function fetchAndCollect(req: LLMRequest): Promise<LLMResponse> {
    const route = resolveRoute(req)
    const res = await doFetch(route, req)
    const events: LLMEvent[] = []
    for await (const line of readLines(res.body!)) {
        events.push(...route.config.protocol.parseChunk(line))
    }
    return buildResponseFromEvents(events)
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
            try: () => withRetry(req.model.provider, () => fetchAndCollect(req)),
            catch: (e: unknown) => LLMError.from(e, req.model.provider),
        })
    },

    // Promise-based API — no Effect import needed in consuming code.
    async generateAsync(req: LLMRequest): Promise<LLMResponse> {
        return withRetry(req.model.provider, () => fetchAndCollect(req))
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
