import { Effect } from "effect"
import { writeFile, readFile, mkdir } from "fs/promises"
import { join } from "path"

export interface CompletedStep {
    index: number
    confidence: number
    timestamp: string
    /** What was actually done — e.g. "created index.html (Nike landing page)". Lets
     *  the agent recall its own prior work instead of just a step count. */
    description?: string
    files?: string[]
}

interface State {
    currentGoal: string
    completedSteps: CompletedStep[]
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
        const merged: State = { ...current, ...patch }
        if (patch.completedSteps) {
            const existing = current.completedSteps.filter(
                s => !patch.completedSteps!.some(n => n.index === s.index),
            )
            merged.completedSteps = [...existing, ...patch.completedSteps]
        }
        if (patch.errorHistory) {
            merged.errorHistory = [...current.errorHistory, ...patch.errorHistory]
        }
        if (patch.knownConstraints) {
            merged.knownConstraints = [
                ...new Set([...current.knownConstraints, ...patch.knownConstraints]),
            ]
        }
        yield* save(merged)
    })
}

export function appendStep(step: { index: number; confidence: number; description?: string; files?: string[] }) {
    return update({
        completedSteps: [{
            index: step.index,
            confidence: step.confidence,
            timestamp: new Date().toISOString(),
            description: step.description,
            files: step.files,
        }],
    })
}

export function setGoal(goal: string) {
    return update({ currentGoal: goal })
}
