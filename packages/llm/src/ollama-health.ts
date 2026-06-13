/** Check whether Ollama is up and a model tag is available locally. */
export async function isOllamaModelAvailable(modelId: string): Promise<boolean> {
    try {
        const res = await fetch("http://localhost:11434/api/tags")
        if (!res.ok) return false
        const data = (await res.json()) as { models?: Array<{ name: string }> }
        const models = data.models ?? []
        const prefix = modelId.split(":")[0]!
        return models.some(m => m.name === modelId || m.name.startsWith(`${prefix}:`))
    } catch {
        return false
    }
}
