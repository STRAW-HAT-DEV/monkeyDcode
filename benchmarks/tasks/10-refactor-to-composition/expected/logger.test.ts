import { test, expect } from "bun:test"
import { FileLogger } from "../src/logger"
import { existsSync, readFileSync, unlinkSync } from "fs"

const LOG_FILE = "/tmp/mdc-bench-logger-test.log"

test("FileLogger.log writes to file", () => {
    try { unlinkSync(LOG_FILE) } catch {}
    const logger = new FileLogger(LOG_FILE)
    logger.log("hello world")
    expect(existsSync(LOG_FILE)).toBe(true)
    const content = readFileSync(LOG_FILE, "utf-8")
    expect(content).toContain("hello world")
})

test("FileLogger does NOT extend BaseLogger (uses composition)", () => {
    const logger = new FileLogger(LOG_FILE)
    // Composition check: no inherited class in prototype chain except Object
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(logger))
    expect(proto).toBe(Object.prototype)
    try { unlinkSync(LOG_FILE) } catch {}
})

test("log message includes timestamp", () => {
    try { unlinkSync(LOG_FILE) } catch {}
    const logger = new FileLogger(LOG_FILE)
    logger.log("test message")
    const content = readFileSync(LOG_FILE, "utf-8")
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T/)
    try { unlinkSync(LOG_FILE) } catch {}
})
