// Honest stub helper. Use for genuinely-unfinished logic so the code compiles
// cleanly and fails loudly at runtime instead of silently returning fake data.

import { Data, Effect } from "effect"

export class NotImplementedError extends Data.TaggedError("NotImplementedError")<{
    feature: string
    reason?: string
}> {}

/**
 * Returns an Effect that fails with {@link NotImplementedError}.
 *
 * Usage inside an Effect.gen body:
 *   yield* notImplemented("compaction.compact", "needs model policy + message formatting")
 */
export function notImplemented(feature: string, reason?: string): Effect.Effect<never, NotImplementedError> {
    return Effect.fail(new NotImplementedError({ feature, reason }))
}
