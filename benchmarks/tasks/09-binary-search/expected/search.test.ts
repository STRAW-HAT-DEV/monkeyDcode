import { test, expect } from "bun:test"
import { binarySearch } from "../src/search"

test("finds element in middle", () => { expect(binarySearch([1,3,5,7,9], 5)).toBe(2) })
test("finds first element",     () => { expect(binarySearch([1,3,5,7,9], 1)).toBe(0) })
test("finds last element",      () => { expect(binarySearch([1,3,5,7,9], 9)).toBe(4) })
test("returns -1 when missing", () => { expect(binarySearch([1,3,5,7,9], 4)).toBe(-1) })
test("empty array",             () => { expect(binarySearch([], 1)).toBe(-1) })
test("single element hit",      () => { expect(binarySearch([7], 7)).toBe(0) })
test("single element miss",     () => { expect(binarySearch([7], 1)).toBe(-1) })
test("large array",             () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i * 2)
    expect(binarySearch(arr, 500)).toBe(250)
})
