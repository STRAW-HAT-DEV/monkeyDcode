// EXPERIMENTAL: durable per-project working memory for the agent loop.
// Persists to .monkeydcode/working-memory.json under the current project root.

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"

export interface State {
    currentGoal: string
    completedSteps: { index: number; confidence: number; timestamp: string }[]
    knownConstraints: string[]
    errorHistory: { step: number; error: string; timestamp: string }[]
}

const DIR = join(process.cwd(), ".monkeydcode")
const FILE = join(DIR, "working-memory.json")

function emptyState(): State {
    return { currentGoal: "", completedSteps: [], knownConstraints: [], errorHistory: [] }
}

export function load(): Effect.Effect<State> {
    return Effect.tryPromise(async () => {
        try {
            return JSON.parse(await readFile(FILE, "utf-8")) as State
        } catch {
            // Expected on first run / missing file: start from an empty state.
            return emptyState()
        }
    }).pipe(Effect.orElseSucceed(() => emptyState()))
}

export function save(state: State): Effect.Effect<void> {
    return Effect.tryPromise(async () => {
        await mkdir(DIR, { recursive: true })
        await writeFile(FILE, JSON.stringify(state, null, 2))
    }).pipe(Effect.orElseSucceed(() => undefined))
}

export function update(patch: Partial<State>): Effect.Effect<void> {
    return Effect.gen(function* () {
        const current = yield* load()
        yield* save({ ...current, ...patch })
    })
}
