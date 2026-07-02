/** Check whether Ollama is up and a model tag is available locally.
 *  Bounded by a short timeout — an unreachable host (blocked network, Ollama
 *  not running) must fail fast rather than hang on the platform's default
 *  fetch timeout, which can be effectively unbounded in sandboxed/CI network
 *  environments and previously caused callers (e.g. sampler tests) to block
 *  for their full outer timeout instead of skipping cleanly. */
export async function isOllamaModelAvailable(
    modelId: string,
    baseUrl = "http://localhost:11434",
    timeoutMs = 2_000,
): Promise<boolean> {
    try {
        const root = baseUrl.replace(/\/v1\/?$/, "")
        const res = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) })
        if (!res.ok) return false
        const data = (await res.json()) as { models?: Array<{ name: string }> }
        const models = data.models ?? []
        const prefix = modelId.split(":")[0]!
        return models.some(m => m.name === modelId || m.name.startsWith(`${prefix}:`))
    } catch {
        return false
    }
}
