import { Effect } from "effect"
import { writeFile, readFile, mkdir } from "fs/promises"
import { join } from "path"

interface State {
    currentGoal: string
    completedSteps: { index: number; confidence: number; timestamp: string }[]
    knownConstraints: string[]
    errorHistory: { step: number; error: string; timestamp: string }[]
}

const FILE = join(process.cwd(), ".monkeydcode", "working-memory.json")

export function load(): Effect.Effect<State> {
    return Effect.tryPromise(async () => {
        try {
            return JSON.parse(await readFile(FILE, "utf-8")) as State
        } catch {
            return { currentGoal: "", completedSteps: [], knownConstraints: [], errorHistory: [] }
        }
    })
}

export function save(state: State) {
    return Effect.tryPromise(async () => {
        await mkdir(join(process.cwd(), ".monkeydcode"), { recursive: true })
        await writeFile(FILE, JSON.stringify(state, null, 2))
    })
}

export function update(patch: Partial<State>) {
    return Effect.gen(function* () {
        const current = yield* load()
        yield* save({ ...current, ...patch })
    })
}
