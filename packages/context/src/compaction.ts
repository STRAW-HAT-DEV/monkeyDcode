// EXPERIMENTAL: conversation compaction.
// `shouldCompact` is a pure, tested heuristic. `compact` is intentionally an
// honest stub — summarization needs a model-selection policy and message
// formatting that don't exist yet, so it fails loudly rather than faking output.

import { notImplemented } from "@monkeydcode/core/util/not-implemented"
import type { Message } from "@monkeydcode/llm"
import { Effect } from "effect"

const COMPACT_EVERY = 5

export function shouldCompact(messageCount: number): boolean {
    return messageCount > 0 && messageCount % COMPACT_EVERY === 0
}

export function compact(_messages: Message[]) {
    return Effect.gen(function* () {
        yield* notImplemented(
            "compaction.compact",
            "needs a model-selection policy and message formatting that are not implemented",
        )
        return [] as Message[]
    })
}
