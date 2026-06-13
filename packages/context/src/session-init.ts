import { Effect } from "effect"
import * as SignatureIndex from "./signature-index.ts"
import * as VectorStore from "./vector_store.ts"
import { call } from "@monkeydcode/python-bridge/bridge"

async function findSourceFiles(rootDir: string): Promise<string[]> {
    const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx,py}")
    const files: string[] = []
    for await (const f of glob.scan({ cwd: rootDir, absolute: true })) {
        if (!f.includes("node_modules") && !f.includes(".git") && !f.includes("dist")) {
            files.push(f)
        }
    }
    return files
}

/** Index project context in background on session start. */
export function initSessionContext(projectRoot: string): Effect.Effect<void, unknown> {
    return Effect.gen(function* () {
        yield* Effect.tryPromise(async () => {
            const files = await findSourceFiles(projectRoot)
            await Promise.allSettled([
                Effect.runPromise(SignatureIndex.indexProject(projectRoot)),
                files.length > 0 ? VectorStore.indexFiles(files) : Promise.resolve(),
                call("knowledgeGraph.build", { project_root: projectRoot }).catch(() => undefined),
            ])
        })
    })
}
