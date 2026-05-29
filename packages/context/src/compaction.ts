export function shouldCompact(messageCount: number): boolean {
    return messageCount > 0 && messageCount % 5 === 0
}

export function compact(messages: Message[]) {
    return Effect.gen(function* () {
        const summary = yield* LLM.generate({
            model: defaultModel,
            prompt: `Summarize this conversation, preserving decisions:\n${format(messages)}`,
            generation: { temperature: 0.3 }
        })
        return [{ role: "system", content: `[Summary] ${summary.text}` }]
    })
}
