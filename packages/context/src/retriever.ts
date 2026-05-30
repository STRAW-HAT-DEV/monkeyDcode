import { Effect } from "effect"
import * as SignatureIndex from "./signature-index.ts"
import * as VectorStore from "./vector_store.ts"
import { call } from "@monkeydcode/python-bridge/bridge"

export interface AssembledContext {
    signatures: SignatureIndex.Signature[]
    relatedExamples: string[]
    graphNeighbors: string[]
}

function knowledgeGraphNeighbors(file: string, depth: number) {
    return Effect.tryPromise(() =>
        call<string[]>("knowledgeGraph.neighbors", { file, depth })
    )
}

export function retrieve(query: { files: string[]; description: string }) {
    return Effect.gen(function* () {
        const sigArrays = yield* Effect.all(
            query.files.map(f => SignatureIndex.extractSignatures(f)),
        )
        const signatures = sigArrays.flat()

        const examples = yield* VectorStore.search(query.description, 5)

        const neighborArrays = yield* Effect.all(
            query.files.map(f => knowledgeGraphNeighbors(f, 2)),
        )
        const graphNeighbors = neighborArrays.flat()

        return { signatures, relatedExamples: examples.map(e => e.text), graphNeighbors }
    })
}

export function formatForPrompt(ctx: AssembledContext): string {
    return `
## Available Functions/Methods
${ctx.signatures.map(s => `- ${s.name}${s.parameters} (${s.file}:${s.line})`).join("\n")}

## Related Code Examples
${ctx.relatedExamples.slice(0, 3).join("\n---\n")}

## Related Files
${ctx.graphNeighbors.slice(0, 10).join("\n")}
`.trim()
}
