import { test, expect } from "bun:test"
import { Runner } from "../src/session/runner.ts"

test("can create session and log messages", () => {
    const session = Runner.createSession(process.cwd(), "smoke-test")
    expect(session.id).toBeDefined()
    expect(session.projectRoot).toBe(process.cwd())

    Runner.logMessage(session.id, "user", "hello")
    Runner.logMessage(session.id, "assistant", "world")

    const history = Runner.getHistory(session.id)
    expect(history.length).toBe(2)
    expect(history[0]?.role).toBe("user")
    expect(history[1]?.role).toBe("assistant")
})
