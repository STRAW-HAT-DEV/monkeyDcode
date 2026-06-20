/** Check whether Ollama is up and a model tag is available locally. */
export async function isOllamaModelAvailable(
    modelId: string,
    baseUrl = "http://localhost:11434",
): Promise<boolean> {
    try {
        const root = baseUrl.replace(/\/v1\/?$/, "")
        const res = await fetch(`${root}/api/tags`)
        if (!res.ok) return false
        const data = (await res.json()) as { models?: Array<{ name: string }> }
        const models = data.models ?? []
        const prefix = modelId.split(":")[0]!
        return models.some(m => m.name === modelId || m.name.startsWith(`${prefix}:`))
    } catch {
        return false
    }
}
