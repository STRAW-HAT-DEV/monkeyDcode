import { test, expect } from "bun:test"
import { resolve } from "path"
import { confine, withDashGuard, PathConfinementError } from "../src/util/fs-guard.ts"

const ROOT = "/tmp/mdc-project"

test("confine accepts a relative path inside the root", () => {
    expect(confine(ROOT, "src/a.ts")).toBe(resolve(ROOT, "src/a.ts"))
})

test("confine accepts the root itself", () => {
    expect(confine(ROOT, ".")).toBe(resolve(ROOT))
})

test("confine accepts an absolute path inside the root", () => {
    expect(confine(ROOT, `${ROOT}/x.ts`)).toBe(`${ROOT}/x.ts`)
})

test("confine rejects traversal via ..", () => {
    expect(() => confine(ROOT, "../secret.ts")).toThrow(PathConfinementError)
})

test("confine rejects an absolute path outside the root", () => {
    expect(() => confine(ROOT, "/etc/passwd")).toThrow(PathConfinementError)
})

test("confine rejects a sibling-prefix escape", () => {
    // /tmp/mdc-project-evil must not be considered inside /tmp/mdc-project
    expect(() => confine(ROOT, "../mdc-project-evil/x.ts")).toThrow(PathConfinementError)
})

test("withDashGuard prefixes the list with --", () => {
    expect(withDashGuard(["a.ts", "b.ts"])).toEqual(["--", "a.ts", "b.ts"])
})
