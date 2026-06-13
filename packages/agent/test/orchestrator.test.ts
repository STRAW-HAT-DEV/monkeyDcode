import { test, expect } from "bun:test"
import { lookup } from "@monkeydcode/consistency/model-capability/registry"
import { parseStepsFromResponse } from "../src/plan-agent.ts"

test("capability registry knows qwen 7b as level 6", () => {
    expect(lookup("qwen2.5-coder:7b")).toBe(6)
})

test("capability registry knows claude opus as level 1", () => {
    expect(lookup("claude-opus-4-8")).toBeNull() // unknown id ok
    expect(lookup("claude-opus-4")).toBe(1)
})

test("parseStepsFromResponse handles JSON array", () => {
    const raw = `[
        {"description": "Create math.ts", "targetFiles": ["src/math.ts"], "changeType": "create", "dependencies": [], "verificationCriteria": "file exists"}
    ]`
    const steps = parseStepsFromResponse(raw)
    expect(steps.length).toBe(1)
    expect(steps[0]?.description).toContain("math")
})
