import { test, expect } from "bun:test"
import { computeFibonacci } from "../src/fib"

test("returns correct values", () => {
    expect(computeFibonacci(0)).toBe(0)
    expect(computeFibonacci(1)).toBe(1)
    expect(computeFibonacci(10)).toBe(55)
    expect(computeFibonacci(20)).toBe(6765)
})

test("handles large input fast (memoized)", () => {
    const start = Date.now()
    expect(computeFibonacci(40)).toBe(102334155)
    const duration = Date.now() - start
    // Without memoization fib(40) takes ~1000ms; with cache it should be <50ms
    expect(duration).toBeLessThan(100)
})

test("second call is faster than first", () => {
    // Warm up
    computeFibonacci(35)
    const start = Date.now()
    computeFibonacci(35)
    expect(Date.now() - start).toBeLessThan(5)
})
