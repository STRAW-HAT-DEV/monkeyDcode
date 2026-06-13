import { describe, expect, test } from "bun:test"
import {
    applyPatch,
    contentTag,
    formatReadOutput,
    globalSnapshotStore,
    looksLikeHashlinePatch,
    parsePatch,
} from "../src/index.ts"

describe("hashline", () => {
    test("contentTag is stable 4-hex", () => {
        const t = contentTag("hello\nworld")
        expect(t).toMatch(/^[0-9a-f]{4}$/)
        expect(contentTag("hello\nworld")).toBe(t)
    })

    test("formatReadOutput records snapshot", () => {
        const { text, entry } = formatReadOutput("a.ts", "line1\nline2", { store: globalSnapshotStore })
        expect(text).toContain("[a.ts#")
        expect(text).toContain("1:line1")
        expect(entry.lineFingerprints.length).toBe(2)
    })

    test("parsePatch sections", () => {
        const patch = parsePatch(`[f.ts#abcd]
replace 2..2:
+new
delete 3`)
        expect(patch.sections.length).toBe(1)
        expect(patch.sections[0].ops.length).toBe(2)
    })

    test("apply replace and insert", async () => {
        const content = "a\nb\nc"
        globalSnapshotStore.record("f.ts", content)
        const tag = contentTag(content)
        const result = await applyPatch(
            `[f.ts#${tag}]
replace 2..2:
+x
insert after 2:
+y`,
            { content, path: "f.ts" },
            globalSnapshotStore,
        )
        expect(result.ok).toBe(true)
        expect(result.content).toBe("a\nx\ny\nc")
    })

    test("rejects stale tag", async () => {
        globalSnapshotStore.record("g.ts", "old")
        const result = await applyPatch(
            `[g.ts#0000]
replace 1..1:
+new`,
            { content: "changed", path: "g.ts" },
            globalSnapshotStore,
        )
        expect(result.ok).toBe(false)
        expect(result.stale).toBe(true)
    })

    test("anchor echo absorption on insert after", async () => {
        const content = "fn() {\n  body\n}"
        globalSnapshotStore.record("h.ts", content)
        const tag = contentTag(content)
        const result = await applyPatch(
            `[h.ts#${tag}]
insert after 1:
+fn() {
+  new
+}`,
            { content, path: "h.ts", strictLines: false },
            globalSnapshotStore,
        )
        expect(result.ok).toBe(true)
        expect(result.content).toContain("new")
    })

    test("looksLikeHashlinePatch", () => {
        expect(looksLikeHashlinePatch("[a#1234]\nreplace 1..1:")).toBe(true)
        expect(looksLikeHashlinePatch("old string")).toBe(false)
    })

    test("verifyBeforeWrite gate", async () => {
        const content = "x\ny"
        globalSnapshotStore.record("gate.ts", content)
        const tag = contentTag(content)
        const blocked = await applyPatch(
            `[gate.ts#${tag}]
replace 1..1:
+bad`,
            {
                content,
                path: "gate.ts",
                verifyBeforeWrite: async () => ({ ok: false, message: "syntax error" }),
            },
            globalSnapshotStore,
        )
        expect(blocked.ok).toBe(false)
        expect(blocked.error).toContain("syntax error")
    })
})
