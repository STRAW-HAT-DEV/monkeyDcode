// EXPERIMENTAL: assembles retrieval context (signatures, related examples,
// working memory) for the agent. Graph neighbors are intentionally empty until
// the knowledge-graph TS wrapper exists (see roadmap).

import { confine } from "@monkeydcode/core/util/fs-guard"
import { Effect } from "effect"
import * as SignatureIndex from "./signature-index.ts"
import type { Signature } from "./signature-index.ts"
import * as VectorStore from "./vector_store.ts"
import * as WorkingMemory from "./working-memory.ts"

export interface AssembledContext {
    signatures: Signature[]
    relatedExamples: string[]
    graphNeighbors: string[]
    workingMemory: WorkingMemory.State
}

export function retrieve(query: { files: string[]; description: string }) {
    return Effect.gen(function* () {
        // Guard model-/caller-supplied paths against traversal outside the project root.
        const root = process.cwd()
        const safeFiles = query.files.map((f) => confine(root, f))

        const signatures = yield* Effect.all(safeFiles.map((f) => SignatureIndex.extractSignatures(f))).pipe(
            Effect.map((arrs) => arrs.flat()),
        )

        const examples = yield* VectorStore.search(query.description, 5)

        // EXPERIMENTAL: knowledge-graph neighbors are not wired up yet — honest empty, not faked.
        const graphNeighbors: string[] = []

        const workingMemory = yield* WorkingMemory.load()

        return {
            signatures,
            relatedExamples: examples.map((e) => e.text),
            graphNeighbors,
            workingMemory,
        }
    })
}

export function formatForPrompt(ctx: AssembledContext): string {
    return `
## Available Functions/Methods
${ctx.signatures.map((s) => `- ${s.name}${s.parameters} (${s.file}:${s.line})`).join("\n")}

## Related Code Examples
${ctx.relatedExamples.slice(0, 3).join("\n---\n")}

## Working Memory
Goal: ${ctx.workingMemory.currentGoal}
Completed: ${ctx.workingMemory.completedSteps.length} steps
Constraints: ${ctx.workingMemory.knownConstraints.join("; ")}
`.trim()
}
