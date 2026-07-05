import { test, expect } from "bun:test"
import { parseJsonArray, parseJsonObject } from "../src/utils.ts"

// ─── parseJsonArray ──────────────────────────────────────────────────────────

test("parseJsonArray extracts a bare array", () => {
    expect(parseJsonArray<number>("[1, 2, 3]")).toEqual([1, 2, 3])
})

test("parseJsonArray extracts a fenced array", () => {
    expect(parseJsonArray<string>('```json\n["a", "b"]\n```')).toEqual(["a", "b"])
})

test("parseJsonArray ignores trailing prose after the array", () => {
    // The greedy first-[-to-last-] approach would fail here (the ] in the prose).
    expect(parseJsonArray<number>("[1, 2] and that's the list].")).toEqual([1, 2])
})

test("parseJsonArray returns [] when there is no array", () => {
    expect(parseJsonArray("no json here")).toEqual([])
})

// ─── parseJsonObject ─────────────────────────────────────────────────────────

test("parseJsonObject extracts a bare object", () => {
    expect(parseJsonObject<{ a: number }>('{"a": 1}')).toEqual({ a: 1 })
})

test("parseJsonObject handles the critic verdict shape with nested arrays", () => {
    const critic = `{
        "validated": [{"file": "a.ts", "line": 1, "message": "bug"}],
        "false_positives": [{"file": "b.ts", "line": 2, "message": "nope"}],
        "missed": [{"file": "c.ts", "line": 3, "message": "new"}]
    }`
    const parsed = parseJsonObject<{ validated: unknown[]; missed: unknown[] }>(critic)
    expect(parsed).not.toBeNull()
    expect(parsed!.validated).toHaveLength(1)
    expect(parsed!.missed).toHaveLength(1)
})

test("parseJsonObject is not fooled by a brace inside a string value", () => {
    const parsed = parseJsonObject<{ msg: string }>('{"msg": "use a } brace"} trailing')
    expect(parsed).toEqual({ msg: "use a } brace" })
})

test("parseJsonObject returns null for an array (not an object)", () => {
    expect(parseJsonObject("[1, 2, 3]")).toBeNull()
})

test("parseJsonObject returns null when there is no object", () => {
    expect(parseJsonObject("nothing structured here")).toBeNull()
})
