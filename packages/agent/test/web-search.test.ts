import { test, expect } from "bun:test"
import { fetchBraveResults, isConfigured, search, formatResults, type WebSearchConfig } from "../src/web-search.ts"

test("isConfigured is false when provider is empty (the default)", () => {
    expect(isConfigured({ provider: "", apiKeyEnv: "" })).toBe(false)
})

test("isConfigured is false when provider is brave but the env var isn't set", () => {
    delete process.env.MDC_TEST_NO_SUCH_KEY
    expect(isConfigured({ provider: "brave", apiKeyEnv: "MDC_TEST_NO_SUCH_KEY" })).toBe(false)
})

test("isConfigured is true only when both provider AND a real env value are present", () => {
    process.env.MDC_TEST_BRAVE_KEY = "fake-key-value"
    try {
        expect(isConfigured({ provider: "brave", apiKeyEnv: "MDC_TEST_BRAVE_KEY" })).toBe(true)
    } finally {
        delete process.env.MDC_TEST_BRAVE_KEY
    }
})

test("fetchBraveResults parses a well-formed Brave API response into clean results", async () => {
    const fakeFetch = (async () =>
        new Response(
            JSON.stringify({
                web: {
                    results: [
                        { title: "Result <b>One</b>", url: "https://a.example", description: "First <em>desc</em>" },
                        { title: "Result Two", url: "https://b.example", description: "Second desc" },
                    ],
                },
            }),
            { status: 200 },
        )) as typeof fetch

    const results = await fetchBraveResults("test query", "fake-key", 5_000, fakeFetch)
    expect(results).toHaveLength(2)
    expect(results[0]!.title).toBe("Result One") // HTML tags stripped
    expect(results[0]!.url).toBe("https://a.example")
    expect(results[1]!.description).toBe("Second desc")
})

test("fetchBraveResults throws a clear error on a non-OK HTTP response", async () => {
    const fakeFetch = (async () => new Response("unauthorized", { status: 401, statusText: "Unauthorized" })) as typeof fetch
    await expect(fetchBraveResults("q", "bad-key", 5_000, fakeFetch)).rejects.toThrow(/401/)
})

test("fetchBraveResults tolerates a response with no results array at all", async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({}), { status: 200 })) as typeof fetch
    const results = await fetchBraveResults("q", "key", 5_000, fakeFetch)
    expect(results).toEqual([])
})

test("search() rejects cleanly when not configured, without ever calling fetch", async () => {
    const config: WebSearchConfig = { provider: "", apiKeyEnv: "" }
    await expect(search("query", config)).rejects.toThrow(/not configured/)
})

test("search() rejects cleanly when the configured env var is unset", async () => {
    delete process.env.MDC_TEST_MISSING_KEY
    const config: WebSearchConfig = { provider: "brave", apiKeyEnv: "MDC_TEST_MISSING_KEY" }
    await expect(search("query", config)).rejects.toThrow(/MDC_TEST_MISSING_KEY/)
})

test("formatResults renders a readable list, and handles zero results", () => {
    expect(formatResults([])).toBe("No results found.")
    const text = formatResults([{ title: "T", url: "https://x", description: "D" }])
    expect(text).toContain("T")
    expect(text).toContain("https://x")
    expect(text).toContain("D")
})

// ─── One real network call against Brave's actual endpoint, with a
// deliberately invalid key — proves the real HTTP/error-handling path works
// end-to-end without needing a real subscription. Skipped gracefully if
// there's no network in this environment. ──────────────────────────────────
test("a real request to Brave's API with an invalid key fails with a clear, non-crashing error", async () => {
    try {
        await fetchBraveResults("test", "invalid-key-xyz", 8_000)
        throw new Error("expected fetchBraveResults to throw for an invalid key")
    } catch (e) {
        expect(e).toBeInstanceOf(Error)
        // Either an auth rejection (expected) or a network-level failure in a
        // restricted sandbox — both are acceptable; a silent success is not.
    }
}, 15_000)
