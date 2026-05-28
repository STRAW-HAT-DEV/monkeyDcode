export function retrieve(query: { files: string[]; description: string }) {
    return Effect.gen(function* () {
        const fileContents = yield* Effect.all(
            query.files.map(f => Effect.tryPromise(() => Bun.file(f).text()))
        )
        return { files: fileContents.join("\n---\n") }
    })
}

async function handleUserMessage(message: string) {
    const program = Effect.gen(function* () {
        const plan = yield* PlanAgent.plan(message, modelId)
        displayPlan(plan)
        yield* BuildAgent.executePlan(plan, modelId)
        return "Done"
    })
    return Effect.runPromise(program)
}
