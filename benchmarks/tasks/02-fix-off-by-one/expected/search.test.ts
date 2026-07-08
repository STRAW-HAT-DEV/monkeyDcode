import { test, expect } from "bun:test"
import { binarySearch } from "./src/search"

test("finds element in middle", () => {
    expect(binarySearch([1, 3, 5, 7, 9], 5)).toBe(2)
})

test("finds first element", () => {
    expect(binarySearch([1, 3, 5, 7, 9], 1)).toBe(0)
})

test("finds last element", () => {
    expect(binarySearch([1, 3, 5, 7, 9], 9)).toBe(4)
})

test("returns -1 for missing element", () => {
    expect(binarySearch([1, 3, 5, 7, 9], 4)).toBe(-1)
})

test("works on single-element array", () => {
    expect(binarySearch([42], 42)).toBe(0)
    expect(binarySearch([42], 1)).toBe(-1)
})

test("works on empty array", () => {
    expect(binarySearch([], 1)).toBe(-1)
})
