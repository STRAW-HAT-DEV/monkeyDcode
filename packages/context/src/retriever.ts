import { Effect } from "effect"
import * as SignatureIndex from "./signature-index.ts"
import * as VectorStore from "./vector_store.ts"
import { call } from "@monkeydcode/python-bridge/bridge"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AssembledContext {
    signatures: SignatureIndex.Signature[]
    relatedExamples: string[]
    graphNeighbors: string[]
}

/**
 * capabilityLevel: 1 = frontier (Claude Opus, GPT-5), 6 = weakest local model.
 * Weak models get LESS context — they get confused by large inputs.
 * Strong models get MORE context — they can reason over broad signals.
 */
export interface RetrieveOptions {
    capabilityLevel?: number
}

// ─── Context size limits by capability level ──────────────────────────────────

const maxSignatures = (level: number) => level <= 2 ? 20 : level <= 4 ? 10 : 5
const maxExamples   = (level: number) => level <= 2 ? 5  : level <= 4 ? 3  : 2
const graphDepth    = (level: number) => level <= 3 ? 2  : 1
const maxNeighbors  = (level: number) => level <= 2 ? 20 : 10

// ─── Retrieve ─────────────────────────────────────────────────────────────────
// All bridge calls fail gracefully — if Python bridge is down, we return empty
// arrays and continue. The agent works with less context rather than crashing.

export function retrieve(
    query: { files: string[]; description: string },
    options: RetrieveOptions = {},
): Effect.Effect<AssembledContext, unknown> {
    const level = options.capabilityLevel ?? 3

    return Effect.tryPromise(async () => {
        // ── Signatures from tree-sitter ──────────────────────────────────────
        const sigArrays = await Promise.all(
            query.files.map(f =>
                Effect.runPromise(SignatureIndex.extractSignatures(f)).catch(
                    () => [] as SignatureIndex.Signature[]
                )
            )
        )
        const signatures = sigArrays.flat().slice(0, maxSignatures(level))

        // ── Semantic examples from vector store ──────────────────────────────
        const examples = await Effect.runPromise(
            VectorStore.search(query.description, maxExamples(level))
        ).catch(() => [] as { text: string; score: number }[])

        // ── Knowledge graph neighbors ─────────────────────────────────────────
        const depth = graphDepth(level)
        const neighborArrays = await Promise.all(
            query.files.map(f =>
                call<string[]>("knowledgeGraph.neighbors", { node: f, depth }).catch(
                    () => [] as string[]
                )
            )
        )
        const graphNeighbors = neighborArrays.flat().slice(0, maxNeighbors(level))

        return { signatures, relatedExamples: examples.map(e => e.text), graphNeighbors }
    })
}

// ─── Format for LLM prompt ────────────────────────────────────────────────────

export function formatForPrompt(ctx: AssembledContext): string {
    const parts: string[] = []

    if (ctx.signatures.length > 0) {
        parts.push(
            "## Available Functions/Methods\n" +
            ctx.signatures
                .map(s => `- ${s.name}${s.parameters} (${s.file}:${s.line})`)
                .join("\n")
        )
    }

    if (ctx.relatedExamples.length > 0) {
        parts.push(
            "## Related Code Examples\n" +
            ctx.relatedExamples.join("\n---\n")
        )
    }

    if (ctx.graphNeighbors.length > 0) {
        parts.push(
            "## Related Files (dependency graph)\n" +
            ctx.graphNeighbors.join("\n")
        )
    }

    return parts.join("\n\n")
}
