import { Effect } from "effect"
import { readFile } from "fs/promises"
import { join } from "path"
import * as SignatureIndex from "./signature-index.ts"
import * as VectorStore from "./vector_store.ts"
import { call } from "@monkeydcode/python-bridge/bridge"

export interface AssembledContext {
    signatures: SignatureIndex.Signature[]
    relatedExamples: string[]
    graphNeighbors: string[]
    workingMemory: {
        currentGoal: string
        completedSteps: { index: number; confidence: number; timestamp: string }[]
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
            completedSteps: { index: number; confidence: number; timestamp: string }[]
            knownConstraints: string[]
        }
    } catch {
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
                Effect.runPromise(SignatureIndex.extractSignatures(f)).catch(
                    () => [] as SignatureIndex.Signature[],
                ),
            ),
        )
        const signatures = sigArrays.flat().slice(0, maxSignatures(level))

        const examples = await Effect.runPromise(
            VectorStore.search(query.description, maxExamples(level)),
        ).catch(() => [] as { text: string; score: number }[])

        const depth = graphDepth(level)
        const neighborArrays = await Promise.all(
            query.files.map(f =>
                call<string[]>("knowledgeGraph.neighbors", { node: f, depth }).catch(() => []),
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
        parts.push(
            "## Working Memory\n" +
            `Goal: ${ctx.workingMemory.currentGoal}\n` +
            `Completed: ${ctx.workingMemory.completedSteps.length} steps\n` +
            `Constraints: ${ctx.workingMemory.knownConstraints.join("; ") || "none"}`,
        )
    }

    return parts.join("\n\n")
}
