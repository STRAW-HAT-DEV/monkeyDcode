// Duplicated from @monkeydcode/mcp-server's identical error.ts — see that
// file's header for why (~20 lines, one other consumer, cheaper than a
// shared package). Same bug it guards against: Effect failures are often
// plain objects, not Error instances, and `String(e)` on those produces the
// useless "[object Object]".

function rootCause(e: unknown): unknown {
    let current = e
    const seen = new Set<unknown>()
    while (current && typeof current === "object" && !seen.has(current)) {
        seen.add(current)
        const c = current as { error?: unknown; cause?: unknown; errors?: unknown[] }
        const next = c.error ?? c.cause ?? (Array.isArray(c.errors) ? c.errors[0] : undefined)
        if (next === undefined || next === current) break
        current = next
    }
    return current
}

export function describeError(e: unknown): string {
    const root = rootCause(e)
    if (root instanceof Error) return root.message
    if (typeof root === "string") return root
    if (root && typeof root === "object") {
        const o = root as { message?: unknown; _tag?: unknown }
        if (typeof o.message === "string" && o.message.length > 0) return o.message
        if (typeof o._tag === "string" && o._tag.length > 0) return o._tag
        try {
            return JSON.stringify(root)
        } catch {
            // fall through
        }
    }
    return String(root)
}
