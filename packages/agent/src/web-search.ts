// Web search — GAPS.md Part 1, gap #6.
//
// Deliberately provider-gated and off by default, same posture as escalation
// and self-tuning: looking things up on the live internet is a real behavior
// change (network egress, potential data exposure in the query text) that
// must be a visible opt-in, not a silent default. Brave Search is the first
// (only) provider: it has a real, documented REST API with a free tier,
// unlike scraping DuckDuckGo's HTML endpoint (fragile, ToS-questionable,
// breaks silently) — matching the "bring your own key" pattern already
// established for every LLM provider in this project.

import { loadConfig, type MdcConfig } from "@monkeydcode/core/mdc-config"

export type WebSearchConfig = MdcConfig["webSearch"]

let cached: Promise<WebSearchConfig> | null = null

/** Session-scoped, same caching stance as mcp-context.ts/permissions.ts —
 *  config is read once per process, not once per tool-loop turn. */
export function getWebSearchConfig(): Promise<WebSearchConfig> {
    if (!cached) {
        cached = loadConfig()
            .then(config => config.webSearch)
            .catch((): WebSearchConfig => ({ provider: "", apiKeyEnv: "" }))
    }
    return cached
}

export interface SearchResult {
    title: string
    url: string
    description: string
}

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search"
const MAX_RESULTS = 5

export function isConfigured(config: WebSearchConfig): boolean {
    return config.provider === "brave" && Boolean(process.env[config.apiKeyEnv])
}

/** The one function with a network side effect — takes an explicit `fetchImpl`
 *  so callers can inject a fake for tests without a real API key or network
 *  access. Defaults to the real global `fetch`. */
export async function fetchBraveResults(
    query: string,
    apiKey: string,
    timeoutMs = 10_000,
    fetchImpl: typeof fetch = fetch,
): Promise<SearchResult[]> {
    const url = new URL(BRAVE_ENDPOINT)
    url.searchParams.set("q", query)
    url.searchParams.set("count", String(MAX_RESULTS))

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const res = await fetchImpl(url, {
            headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
            signal: controller.signal,
        })
        if (!res.ok) {
            throw new Error(`Brave Search API returned ${res.status} ${res.statusText}`)
        }
        const data = (await res.json()) as {
            web?: { results?: Array<{ title?: unknown; url?: unknown; description?: unknown }> }
        }
        const results = data.web?.results ?? []
        // Brave highlights matched query terms with <strong>/<b> markup in
        // BOTH title and description — strip it from both, not just one.
        const stripHtml = (v: unknown): string => (typeof v === "string" ? v.replace(/<\/?[^>]+>/g, "") : "")
        return results.slice(0, MAX_RESULTS).map(r => ({
            title: stripHtml(r.title),
            url: typeof r.url === "string" ? r.url : "",
            description: stripHtml(r.description),
        }))
    } finally {
        clearTimeout(timer)
    }
}

/** Search using whatever provider `config` names — throws a plain Error with
 *  a clear message on any failure (bad key, network error, rate limit);
 *  callers (tool-loop.ts) are responsible for turning that into a
 *  non-fatal observation string, same as every other RUN diagnostic. */
export async function search(query: string, config: WebSearchConfig): Promise<SearchResult[]> {
    if (config.provider !== "brave") {
        throw new Error("web search is not configured — set [web_search] provider = \"brave\" and api_key_env in config.toml")
    }
    const apiKey = process.env[config.apiKeyEnv]
    if (!apiKey) {
        throw new Error(`web search is configured but ${config.apiKeyEnv} is not set in the environment`)
    }
    return fetchBraveResults(query, apiKey)
}

export function formatResults(results: SearchResult[]): string {
    if (results.length === 0) return "No results found."
    return results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`)
        .join("\n\n")
}
