import { test, expect } from "bun:test"
import { Effect, Exit } from "effect"

/**
 * Regression guard for the recovery pattern used by the sampler's escalation
 * hook and the build agent's recon / pre-step-check wrappers (ROADMAP Phase 2).
 *
 * Those sites must recover from a failing best-effort sub-effect WITHOUT
 * crashing the task. The failures they face are DEFECTS (an `Effect.promise`
 * wrapping a rejecting LLM call, or a synchronous `throw` from resolveModel),
 * not E-channel failures. Two traps this test pins down, both of which shipped
 * silently once because the live path was never exercised:
 *
 *  1. `Effect.catch` only recovers E-channel failures, NOT defects.
 *  2. In this Effect build, the 2-arg `Effect.catch(effect, handler)` form
 *     mis-resolves to a curried function that throws "not a function" when
 *     yield*'d — so it never even composed.
 *
 * The chosen fix is `inner.pipe(Effect.exit)` + `Exit.isSuccess`. If a future
 * Effect upgrade or a careless refactor breaks that, this test fails instead
 * of a production task crashing.
 */

function recover<A>(inner: Effect.Effect<A, unknown>, fallback: A): Effect.Effect<A, never> {
    return Effect.gen(function* () {
        const exit = yield* inner.pipe(Effect.exit)
        return Exit.isSuccess(exit) ? exit.value : fallback
    })
}

test("recovers from a defect (Effect.promise rejection) to the fallback", async () => {
    const defect = Effect.gen(function* () {
        yield* Effect.promise(() => Promise.reject(new Error("LLM 500")))
        return "unreachable"
    })
    const result = await Effect.runPromise(recover(defect, "FALLBACK"))
    expect(result).toBe("FALLBACK")
})

test("recovers from a synchronous throw (bad provider) to the fallback", async () => {
    const syncThrow = Effect.gen(function* () {
        throw new Error("resolveModel: unknown provider")
        return "unreachable"
    })
    const result = await Effect.runPromise(recover(syncThrow, "FALLBACK"))
    expect(result).toBe("FALLBACK")
})

test("recovers from an E-channel failure to the fallback", async () => {
    const typedFail = Effect.gen(function* () {
        yield* Effect.tryPromise(() => Promise.reject(new Error("typed")))
        return "unreachable"
    })
    const result = await Effect.runPromise(recover(typedFail, "FALLBACK"))
    expect(result).toBe("FALLBACK")
})

test("passes a successful value through unchanged", async () => {
    const ok = Effect.succeed("REAL")
    const result = await Effect.runPromise(recover(ok, "FALLBACK"))
    expect(result).toBe("REAL")
})
