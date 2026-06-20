import { test, expect } from "bun:test"
import { validateUser } from "../src/validator"

test("accepts valid user", () => {
    const r = validateUser({ name: "Alice", email: "alice@example.com", age: 30 })
    expect(r.valid).toBe(true)
})

test("rejects empty name", () => {
    const r = validateUser({ name: "", email: "a@b.com", age: 25 })
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some(e => e.toLowerCase().includes("name"))).toBe(true)
})

test("rejects name over 100 chars", () => {
    const r = validateUser({ name: "a".repeat(101), email: "a@b.com", age: 25 })
    expect(r.valid).toBe(false)
})

test("rejects invalid email (no @)", () => {
    const r = validateUser({ name: "Bob", email: "notanemail", age: 25 })
    expect(r.valid).toBe(false)
})

test("rejects invalid email (no dot after @)", () => {
    const r = validateUser({ name: "Bob", email: "bob@nodot", age: 25 })
    expect(r.valid).toBe(false)
})

test("rejects age below 0", () => {
    const r = validateUser({ name: "Bob", email: "b@b.com", age: -1 })
    expect(r.valid).toBe(false)
})

test("rejects age above 150", () => {
    const r = validateUser({ name: "Bob", email: "b@b.com", age: 151 })
    expect(r.valid).toBe(false)
})

test("collects multiple errors", () => {
    const r = validateUser({ name: "", email: "bad", age: 999 })
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.length).toBeGreaterThan(1)
})
