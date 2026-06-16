import { test, expect } from "bun:test"
import {
    StaticAssetStageSelector,
    defaultStageSelector,
} from "../src/verification/stage-selector.ts"
import type { Stage } from "../src/verification/types.ts"

const FULL: Stage[] = ["syntax", "typecheck", "lint", "tests"]

test("code files keep the full configured stage set (no behavior change)", () => {
    for (const f of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.py", "a.rs", "a.go"]) {
        expect(defaultStageSelector.select([f], FULL)).toEqual(FULL)
    }
})

test("a mixed changeset with any code file keeps the full stage set", () => {
    expect(defaultStageSelector.select(["index.html", "app.ts"], FULL)).toEqual(FULL)
})

test("static-only changeset drops code-only stages", () => {
    expect(defaultStageSelector.select(["index.html"], FULL)).toEqual(["syntax"])
    expect(defaultStageSelector.select(["styles.css", "page.html"], FULL)).toEqual(["syntax"])
})

test("static-only changeset keeps smoke if configured", () => {
    const selector = new StaticAssetStageSelector()
    expect(selector.select(["index.html"], ["syntax", "tests", "smoke"])).toEqual([
        "syntax",
        "smoke",
    ])
})

test("empty file list preserves configured stages", () => {
    expect(defaultStageSelector.select([], FULL)).toEqual(FULL)
})

test("selector is configurable (Open/Closed): custom code extensions", () => {
    const selector = new StaticAssetStageSelector(new Set(["html"]))
    expect(selector.select(["index.html"], FULL)).toEqual(FULL)
})
