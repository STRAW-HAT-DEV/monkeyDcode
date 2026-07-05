export { resolveModel } from "@monkeydcode/llm/resolve-model"

/**
 * Extract the first complete top-level JSON array from free-form model output
 * by bracket-depth matching (tries a fenced ```json block first). More robust
 * than a greedy first-`[`-to-last-`]` regex, which silently mis-parses
 * whenever trailing prose after the array happens to contain a stray `]`.
 * Shared by every agent that asks a model for a JSON array (review, debug).
 */
export function extractJsonArray(text: string): string | null {
    const fenced = text.match(/```(?:json)?\s*\n(\[[\s\S]*?\])\s*```/)
    if (fenced?.[1]) return fenced[1]

    const start = text.indexOf("[")
    if (start === -1) return null

    let depth = 0
    for (let i = start; i < text.length; i++) {
        if (text[i] === "[") depth++
        else if (text[i] === "]") {
            depth--
            if (depth === 0) return text.slice(start, i + 1)
        }
    }
    return null
}

/** Parse a JSON array from free-form model output, returning [] on any failure. */
export function parseJsonArray<T>(text: string): T[] {
    const candidate = extractJsonArray(text)
    if (!candidate) return []
    try {
        const parsed = JSON.parse(candidate)
        return Array.isArray(parsed) ? (parsed as T[]) : []
    } catch {
        return []
    }
}

/**
 * Extract the first complete top-level JSON object from free-form model output
 * by brace-depth matching (tries a fenced ```json block first). The object
 * counterpart to extractJsonArray — needed whenever a prompt asks for a shaped
 * object (e.g. the review critic's `{validated, false_positives, missed}`)
 * rather than a bare array. Brace-aware, so a greedy first-`{`-to-last-`}`
 * mismatch on trailing prose can't corrupt it.
 */
export function extractJsonObject(text: string): string | null {
    const fenced = text.match(/```(?:json)?\s*\n(\{[\s\S]*?\})\s*```/)
    if (fenced?.[1]) return fenced[1]

    const start = text.indexOf("{")
    if (start === -1) return null

    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i++) {
        const ch = text[i]
        if (inString) {
            if (escaped) escaped = false
            else if (ch === "\\") escaped = true
            else if (ch === '"') inString = false
            continue
        }
        if (ch === '"') inString = true
        else if (ch === "{") depth++
        else if (ch === "}") {
            depth--
            if (depth === 0) return text.slice(start, i + 1)
        }
    }
    return null
}

/** Parse a JSON object from free-form model output, returning null on any failure. */
export function parseJsonObject<T>(text: string): T | null {
    const candidate = extractJsonObject(text)
    if (!candidate) return null
    try {
        const parsed = JSON.parse(candidate)
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null
    } catch {
        return null
    }
}
