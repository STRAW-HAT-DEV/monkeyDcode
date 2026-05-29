import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { PlanParseError, loadPrompt, parseStepsFromResponse } from "../src/plan-agent.ts"

const VALID = JSON.stringify([
    { description: "d", targetFiles: ["a.ts"], changeType: "modify", dependencies: [], verificationCriteria: "v" },
])

test("parses a fenced JSON plan", () => {
    const steps = parseStepsFromResponse(`\`\`\`json\n${VALID}\n\`\`\``)
    expect(steps).toHaveLength(1)
    expect(steps[0]!.changeType).toBe("modify")
})

test("parses a bare JSON array embedded in prose", () => {
    const steps = parseStepsFromResponse(`Here is the plan: ${VALID} done.`)
    expect(steps).toHaveLength(1)
})

test("throws PlanParseError on schema mismatch", () => {
    expect(() => parseStepsFromResponse('[{"description":123}]')).toThrow(PlanParseError)
})

test("throws PlanParseError when there is no JSON array", () => {
    expect(() => parseStepsFromResponse("no json here")).toThrow(PlanParseError)
})

test("loadPrompt reads a bundled prompt template", async () => {
    const text = await Effect.runPromise(loadPrompt("plan-level-1.txt"))
    expect(text).toInclude("{TASK}")
})

test("loadPrompt rejects a path-escape attempt", async () => {
    const exit = await Effect.runPromiseExit(loadPrompt("../../../etc/passwd"))
    expect(Exit.isFailure(exit)).toBe(true)
})
