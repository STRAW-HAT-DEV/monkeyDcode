import { Effect } from "effect"
import { readFile } from "fs/promises"
import { join } from "path"
import * as SignatureIndex from "./signature-index.ts"
import * as VectorStore from "./vector_store.ts"
import { call } from "@monkeydcode/python-bridge/bridge"

interface WorkingMemoryStep {
    index: number
    confidence: number
    timestamp: string
    description?: string
    files?: string[]
}

export interface AssembledContext {
    signatures: SignatureIndex.Signature[]
    relatedExamples: string[]
    graphNeighbors: string[]
    workingMemory: {
        currentGoal: string
        completedSteps: WorkingMemoryStep[]
        knownConstraints: string[]
    }
}

export interface RetrieveOptions {
    capabilityLevel?: number
}

const maxSignatures = (level: number) => level <= 2 ? 20 : level <= 4 ? 10 : 5
const maxExamples   = (level: number) => level <= 2 ? 5  : level <= 4 ? 3  : 2
const graphDepth    = (level: number) => level <= 3 ? 2  : 1
const maxNeighbors  = (level: number) => level <= 2 ? 20 : 10

async function loadWorkingMemory() {
    try {
        const raw = await readFile(join(process.cwd(), ".monkeydcode", "working-memory.json"), "utf-8")
        return JSON.parse(raw) as {
            currentGoal: string
            completedSteps: WorkingMemoryStep[]
            knownConstraints: string[]
        }
    } catch {
        // No working-memory.json yet is normal (first run); anything else means
        // the agent silently loses all memory of prior steps for this turn.
        return { currentGoal: "", completedSteps: [], knownConstraints: [] }
    }
}

export function retrieve(
    query: { files: string[]; description: string },
    options: RetrieveOptions = {},
): Effect.Effect<AssembledContext, unknown> {
    const level = options.capabilityLevel ?? 3

    return Effect.tryPromise(async () => {
        const sigArrays = await Promise.all(
            query.files.map(f =>
                Effect.runPromise(SignatureIndex.extractSignatures(f)).catch(err => {
                    console.warn(`[retriever] signature extraction failed for ${f}:`, err)
                    return [] as SignatureIndex.Signature[]
                }),
            ),
        )
        const signatures = sigArrays.flat().slice(0, maxSignatures(level))

        const examples = await Effect.runPromise(
            VectorStore.search(query.description, maxExamples(level)),
        ).catch(err => {
            console.warn("[retriever] vector store search failed:", err)
            return [] as { text: string; score: number }[]
        })

        const depth = graphDepth(level)
        const neighborArrays = await Promise.all(
            query.files.map(f =>
                call<string[]>("knowledgeGraph.neighbors", { node: f, depth }).catch(err => {
                    console.warn(`[retriever] knowledge graph lookup failed for ${f}:`, err)
                    return []
                }),
            ),
        )
        const graphNeighbors = neighborArrays.flat().slice(0, maxNeighbors(level))
        const wm = await loadWorkingMemory()

        return {
            signatures,
            relatedExamples: examples.map(e => e.text),
            graphNeighbors,
            workingMemory: {
                currentGoal: wm.currentGoal,
                completedSteps: wm.completedSteps,
                knownConstraints: wm.knownConstraints,
            },
        }
    })
}

export function formatForPrompt(ctx: AssembledContext): string {
    const parts: string[] = []

    if (ctx.signatures.length > 0) {
        parts.push(
            "## Available Functions/Methods\n" +
            ctx.signatures
                .map(s => `- ${s.name}${s.parameters} (${s.file}:${s.line})`)
                .join("\n"),
        )
    }

    if (ctx.relatedExamples.length > 0) {
        parts.push(
            "## Related Code Examples\n" +
            ctx.relatedExamples.join("\n---\n"),
        )
    }

    if (ctx.graphNeighbors.length > 0) {
        parts.push(
            "## Related Files (dependency graph)\n" +
            ctx.graphNeighbors.join("\n"),
        )
    }

    if (ctx.workingMemory.currentGoal || ctx.workingMemory.completedSteps.length > 0) {
        // Render what was actually built, not just how many steps ran — the model
        // needs to know it already created index.html with a hero section, not
        // just that "1 step" happened, or it treats every turn as a blank slate.
        const recentSteps = ctx.workingMemory.completedSteps.slice(-10)
        const stepLines = recentSteps.map(s => {
            const files = s.files && s.files.length > 0 ? ` [${s.files.join(", ")}]` : ""
            return `- ${s.description ?? `step ${s.index}`}${files}`
        })
        parts.push(
            "## Working Memory (what you already built — do not recreate this from scratch)\n" +
            `Goal: ${ctx.workingMemory.currentGoal}\n` +
            (stepLines.length > 0 ? `Previously completed:\n${stepLines.join("\n")}\n` : "") +
            `Constraints: ${ctx.workingMemory.knownConstraints.join("; ") || "none"}`,
        )
    }

    return parts.join("\n\n")
}
