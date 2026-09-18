/**
 * Adversarial tests for @monkeydcode/hashline.
 *
 * Every test asserts the behaviour a user would reasonably EXPECT from the
 * README claim ("a stale or misaligned patch is detected and rejected, never
 * silently applied wrong"). A FAILING test therefore documents a defect, not
 * a wrong test. Names are prefixed with [BUG?] where a failure was anticipated
 * from code reading.
 */
import { describe, expect, test } from "bun:test"
import {
    applyPatch,
    contentTag,
    formatReadOutput,
    lineFingerprint,
    looksLikeHashlinePatch,
    parsePatch,
    SnapshotStore,
} from "../src/index.ts"

// ─── helpers ──────────────────────────────────────────────────────────────────

function fresh(path: string, content: string) {
    const store = new SnapshotStore()
    store.record(path, content)
    return { store, tag: contentTag(content) }
}

/** Brute-force a content B !== A with contentTag(B) === contentTag(A), varying line `lineNo`. */
function findTagCollision(a: string, lineNo: number, maxIter = 2_000_000): string {
    const target = contentTag(a)
    const lines = a.split("\n")
    for (let i = 0; i < maxIter; i++) {
        const copy = [...lines]
        copy[lineNo - 1] = `${lines[lineNo - 1]}_${i}`
        const b = copy.join("\n")
        if (b !== a && contentTag(b) === target) return b
    }
    throw new Error("no collision found")
}

// ─── 1. staleness: tag ────────────────────────────────────────────────────────

describe("staleness via tag", () => {
    test("stale tag is rejected", async () => {
        const { store } = fresh("f.ts", "a\nb\nc")
        const r = await applyPatch(`[f.ts#0000]\nreplace 2..2:\n+x`, { content: "a\nb\nc", path: "f.ts" }, store)
        expect(r.ok).toBe(false)
        expect(r.stale).toBe(true)
    })

    test("uppercase tag is accepted", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag.toUpperCase()}]\nreplace 2..2:\n+x`, { content, path: "f.ts" }, store)
        expect(r.ok).toBe(true)
    })

    test("tag is 16 bits: two different file states share a tag with p = 1/65536 (birthday: duplicates in 1000 states)", () => {
        const tags = new Set<string>()
        for (let i = 0; i < 1000; i++) tags.add(contentTag(`export const v${i} = ${i}\n`))
        // P(no duplicate in 1000 draws from 65536) = exp(-1000^2 / (2*65536)) ~= 0.05%
        expect(tags.size).toBeLessThan(1000)
    })

    test("brute-force: a different file state with the SAME tag exists and is found in < 2M tries", () => {
        const a = "a\nb\nc"
        const b = findTagCollision(a, 2)
        expect(b).not.toBe(a)
        expect(contentTag(b)).toBe(contentTag(a))
    })
})

// ─── 2. staleness: per-line fingerprints ──────────────────────────────────────

describe("staleness via per-line fingerprints", () => {
    test("correct (colliding) tag but touched line changed -> rejected by fingerprint (library-level, snapshot from read time)", async () => {
        const a = "a\nb\nc"
        const b = findTagCollision(a, 2) // line 2 differs, same tag
        const { store, tag } = fresh("f.ts", a) // snapshot taken at READ time (state A)
        const r = await applyPatch(`[f.ts#${tag}]\nreplace 2..2:\n+x`, { content: b, path: "f.ts" }, store)
        expect(r.ok).toBe(false)
        expect(r.stale).toBe(true)
    })

    test("[BUG?] build-agent re-records the snapshot from LIVE content right before apply -> fingerprints compare live-to-live and can never reject", async () => {
        const a = "a\nb\nc"
        const b = findTagCollision(a, 2)
        const { store, tag } = fresh("f.ts", a)
        // packages/agent/src/build-agent.ts:475  globalSnapshotStore.record(relPath, existing)
        store.record("f.ts", b)
        const r = await applyPatch(`[f.ts#${tag}]\nreplace 2..2:\n+x`, { content: b, path: "f.ts" }, store)
        expect(r.ok).toBe(false) // expected: reject, the line the model saw is gone
    })

    test("[BUG?] strictLines with NO snapshot recorded: fingerprint check is silently skipped, colliding state is patched", async () => {
        const a = "a\nb\nc"
        const b = findTagCollision(a, 2)
        const store = new SnapshotStore() // nothing recorded
        const r = await applyPatch(`[f.ts#${contentTag(a)}]\nreplace 2..2:\n+x`, { content: b, path: "f.ts" }, store)
        expect(r.ok).toBe(false)
    })

    test("insert anchors are not fingerprint-verified (insert after N with changed line N, colliding tag)", async () => {
        const a = "a\nb\nc"
        const b = findTagCollision(a, 2)
        const { store, tag } = fresh("f.ts", a)
        const r = await applyPatch(`[f.ts#${tag}]\ninsert after 2:\n+x`, { content: b, path: "f.ts" }, store)
        expect(r.ok).toBe(false)
    })
})

// ─── 3. path matching ─────────────────────────────────────────────────────────

describe("path matching", () => {
    test("[BUG?] section for a DIFFERENT file with identical content is applied to the target (sections[0] fallback)", async () => {
        const content = "export {}\n"
        const store = new SnapshotStore()
        store.record("a.ts", content)
        store.record("b.ts", content)
        const tag = contentTag(content)
        const r = await applyPatch(`[a.ts#${tag}]\nreplace 1..1:\n+export const x = 1`, { content, path: "b.ts" }, store)
        expect(r.ok).toBe(false) // section says a.ts; we are applying to b.ts
    })

    test("[BUG?] basename fallback: src/a/x.ts section patches src/b/x.ts", async () => {
        const content = "export {}\n"
        const store = new SnapshotStore()
        store.record("src/b/x.ts", content)
        const tag = contentTag(content)
        const r = await applyPatch(
            `[src/a/x.ts#${tag}]\nreplace 1..1:\n+export const x = 1`,
            { content, path: "src/b/x.ts" },
            store,
        )
        expect(r.ok).toBe(false)
    })

    test("backslash paths normalise for snapshot lookup and section matching", async () => {
        const content = "a\nb\nc"
        const store = new SnapshotStore()
        store.record("src\\f.ts", content)
        const tag = contentTag(content)
        const r = await applyPatch(`[src\\f.ts#${tag}]\nreplace 2..2:\n+x`, { content, path: "src/f.ts" }, store)
        expect(r.ok).toBe(true)
        expect(r.content).toBe("a\nx\nc")
    })

    test("[BUG?] two sections for the same path in one patch: both applied", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(
            `[f.ts#${tag}]\nreplace 1..1:\n+x\n[f.ts#${tag}]\nreplace 3..3:\n+z`,
            { content, path: "f.ts" },
            store,
        )
        expect(r.ok).toBe(true)
        expect(r.content).toBe("x\nb\nz")
    })

    test("multi-file patch: only the matching section is applied for this path (by design)", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("b.ts", content)
        const r = await applyPatch(
            `[a.ts#ffff]\nreplace 1..1:\n+WRONG\n[b.ts#${tag}]\nreplace 2..2:\n+x`,
            { content, path: "b.ts" },
            store,
        )
        expect(r.ok).toBe(true)
        expect(r.content).toBe("a\nx\nc")
    })
})

// ─── 4. op semantics ──────────────────────────────────────────────────────────

describe("op semantics", () => {
    test("[BUG?] overlapping ops in one section are rejected (not silently merged with data loss)", async () => {
        const content = "a\nb\nc\nd\ne"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(
            `[f.ts#${tag}]\nreplace 2..4:\n+X\nreplace 3..3:\n+Y`,
            { content, path: "f.ts" },
            store,
        )
        // Either reject, or keep both edits. Silently dropping Y is the bug.
        expect(r.ok === false || (r.content ?? "").includes("Y")).toBe(true)
    })

    test("replace with end < start is rejected", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\nreplace 3..2:\n+x`, { content, path: "f.ts" }, store)
        expect(r.ok).toBe(false)
    })

    test("replace beyond EOF is rejected", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\nreplace 3..4:\n+x`, { content, path: "f.ts" }, store)
        expect(r.ok).toBe(false)
    })

    test("insert after last line", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\ninsert after 3:\n+d`, { content, path: "f.ts" }, store)
        expect(r.content).toBe("a\nb\nc\nd")
    })

    test("insert after N+1 (past EOF) is rejected", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\ninsert after 4:\n+d`, { content, path: "f.ts" }, store)
        expect(r.ok).toBe(false)
    })

    test("insert before line 1", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\ninsert before 1:\n+z`, { content, path: "f.ts" }, store)
        expect(r.content).toBe("z\na\nb\nc")
    })

    test("insert head / tail on non-empty file", async () => {
        const content = "a\nb"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\ninsert head:\n+h\ninsert tail:\n+t`, { content, path: "f.ts" }, store)
        expect(r.content).toBe("h\na\nb\nt")
    })

    test("delete whole file", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\ndelete 1..3`, { content, path: "f.ts" }, store)
        expect(r.ok).toBe(true)
        expect(r.content).toBe("")
    })

    test("empty file: insert head works", async () => {
        const content = ""
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\ninsert head:\n+x`, { content, path: "f.ts" }, store)
        expect(r.ok).toBe(true)
        expect(r.content).toBe("x")
    })

    test("[BUG?] empty file: read output shows a line 1 but replace 1..1 is rejected (read/apply disagree)", async () => {
        const content = ""
        const store = new SnapshotStore()
        const { text, entry } = formatReadOutput("f.ts", content, { store })
        expect(text).toContain("\n1:") // the model is shown a line 1
        const r = await applyPatch(`[f.ts#${entry.tag}]\nreplace 1..1:\n+x`, { content, path: "f.ts" }, store)
        expect(r.ok).toBe(true)
    })

    test("ops given out of order (ascending) apply against ORIGINAL numbering", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(
            `[f.ts#${tag}]\nreplace 1..1:\n+x\ninsert after 1:\n+y\nreplace 3..3:\n+z`,
            { content, path: "f.ts" },
            store,
        )
        expect(r.content).toBe("x\ny\nb\nz")
    })

    test("[BUG?] same-line ops: multi-line `replace N..N` followed by `insert after N` (the prompt's own example shape)", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(
            `[f.ts#${tag}]\nreplace 2..2:\n+x1\n+x2\ninsert after 2:\n+y`,
            { content, path: "f.ts" },
            store,
        )
        // "insert after ORIGINAL line 2" must land after the whole replacement, not inside it
        expect(r.content).toBe("a\nx1\nx2\ny\nc")
    })

    test("[BUG?] same-line ops: `insert before N` followed by `replace N..N` (patch order) loses the inserted line", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(
            `[f.ts#${tag}]\ninsert before 2:\n+y\nreplace 2..2:\n+x`,
            { content, path: "f.ts" },
            store,
        )
        expect(r.content).toBe("a\ny\nx\nc")
    })

    test("same-line ops in the other order work (order-dependence)", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(
            `[f.ts#${tag}]\nreplace 2..2:\n+x\ninsert before 2:\n+y`,
            { content, path: "f.ts" },
            store,
        )
        expect(r.content).toBe("a\ny\nx\nc")
    })
})

// ─── 5. anchor echo ───────────────────────────────────────────────────────────

describe("absorbAnchorEcho", () => {
    test("[BUG?] false positive: legitimately inserting a line identical to the anchor drops it", async () => {
        // Realistic: adding a second `  }` after an existing `  }` when closing a new nested block.
        const content = "function f() {\n  if (a) {\n    x()\n  }\n}"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(
            `[f.ts#${tag}]\ninsert after 4:\n+  }\n+  if (b) {\n+    y()\n+  }`,
            { content, path: "f.ts", strictLines: false },
            store,
        )
        expect(r.content).toBe("function f() {\n  if (a) {\n    x()\n  }\n  }\n  if (b) {\n    y()\n  }\n}")
    })

    test("[BUG?] false positive on blank line: inserting a blank line after a blank line", async () => {
        const content = "a\n\nb"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\ninsert after 2:\n+\n+x`, { content, path: "f.ts" }, store)
        expect(r.content).toBe("a\n\n\nx\nb")
    })
})

// ─── 6. body escaping ─────────────────────────────────────────────────────────

describe("body escaping", () => {
    test("`++foo` yields `+foo`", () => {
        const p = parsePatch(`[f.ts#abcd]\nreplace 1..1:\n++foo`)
        expect((p.sections[0]!.ops[0] as any).lines).toEqual(["+foo"])
    })

    test("[BUG?] `+-foo` yields `-foo` (prompt.ts: 'Prefix ++ or +- for lines starting with + or -')", () => {
        const p = parsePatch(`[f.ts#abcd]\nreplace 1..1:\n+-foo`)
        expect((p.sections[0]!.ops[0] as any).lines).toEqual(["-foo"])
    })

    test("[BUG?] a YAML/markdown list item `- item` written naturally as `+- item` keeps its dash", () => {
        const p = parsePatch(`[f.yaml#abcd]\nreplace 1..1:\n+- item`)
        expect((p.sections[0]!.ops[0] as any).lines).toEqual(["- item"])
    })

    test("`+--flag` currently yields `-flag` (the undocumented way to write a dash)", () => {
        const p = parsePatch(`[f.sh#abcd]\nreplace 1..1:\n+--flag`)
        expect((p.sections[0]!.ops[0] as any).lines).toEqual(["-flag"])
    })

    test("`+` alone is a blank line", () => {
        const p = parsePatch(`[f.ts#abcd]\nreplace 1..1:\n+\n+x`)
        expect((p.sections[0]!.ops[0] as any).lines).toEqual(["", "x"])
    })
})

// ─── 7. parser leniency ───────────────────────────────────────────────────────

describe("parser leniency (silent partial application)", () => {
    test("[BUG?] malformed op header (missing colon) is not silently dropped", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\nreplace 1..1:\n+x\nreplace 2..2\n+y`, { content, path: "f.ts" }, store)
        expect(r.ok === false || r.content === "x\ny\nc").toBe(true)
    })

    test("[BUG?] unknown op `delete block 2` is not silently dropped", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\nreplace 1..1:\n+x\ndelete block 2`, { content, path: "f.ts" }, store)
        expect(r.ok === false || r.content === "x\nc").toBe(true)
    })

    test("[BUG?] body line missing its `+` prefix is not silently dropped", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\nreplace 1..1:\n+x\ny`, { content, path: "f.ts" }, store)
        expect(r.ok === false || r.content === "x\ny\nb\nc").toBe(true)
    })

    test("[BUG?] looksLikeHashlinePatch false positive on prose like `[issue#1234] ...`", () => {
        expect(looksLikeHashlinePatch("Fixed the bug.\n[issue#1234] was the root cause.")).toBe(false)
    })
})

// ─── 8. encoding & newlines ───────────────────────────────────────────────────

describe("encoding and newline preservation", () => {
    test("[BUG?] CRLF file: a one-line patch preserves CRLF elsewhere", async () => {
        const content = "a\r\nb\r\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\nreplace 2..2:\n+x`, { content, path: "f.ts" }, store)
        expect(r.ok).toBe(true)
        expect(r.content).toBe("a\r\nx\r\nc")
    })

    test("[BUG?] BOM file: a one-line patch preserves the BOM", async () => {
        const content = "﻿a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\nreplace 2..2:\n+x`, { content, path: "f.ts" }, store)
        expect(r.ok).toBe(true)
        expect(r.content).toBe("﻿a\nx\nc")
    })

    test("trailing newline preserved through replace", async () => {
        const content = "a\nb\n"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\nreplace 1..1:\n+x`, { content, path: "f.ts" }, store)
        expect(r.content).toBe("x\nb\n")
    })

    test("trailing newline preserved through insert after last real line", async () => {
        const content = "a\nb\n"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\ninsert after 2:\n+c`, { content, path: "f.ts" }, store)
        expect(r.content).toBe("a\nb\nc\n")
    })

    test("[BUG?] insert tail on a file with trailing newline appends AFTER the phantom empty line", async () => {
        const content = "a\nb\n"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(`[f.ts#${tag}]\ninsert tail:\n+c`, { content, path: "f.ts" }, store)
        expect(r.content).toBe("a\nb\nc\n")
    })

    test("read output shows a phantom empty last line for files ending in newline", () => {
        const { text } = formatReadOutput("f.ts", "a\nb\n", { store: new SnapshotStore() })
        expect(text).toContain("\n3:\n") // documented, so a model can reason about it
    })
})

// ─── 9. verifyBeforeWrite gate ───────────────────────────────────────────────

describe("verifyBeforeWrite gate", () => {
    test("gate receives the exact next content and a rejection leaves the snapshot untouched", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        let seen = ""
        const r = await applyPatch(
            `[f.ts#${tag}]\nreplace 2..2:\n+x`,
            { content, path: "f.ts", verifyBeforeWrite: async next => { seen = next; return { ok: false, message: "nope" } } },
            store,
        )
        expect(seen).toBe("a\nx\nc")
        expect(r.ok).toBe(false)
        expect(r.error).toContain("nope")
        expect(store.get("f.ts")!.content).toBe(content)
    })

    test("gate ok -> snapshot advanced to new content and newTag returned", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(
            `[f.ts#${tag}]\nreplace 2..2:\n+x`,
            { content, path: "f.ts", verifyBeforeWrite: async () => ({ ok: true }) },
            store,
        )
        expect(r.ok).toBe(true)
        expect(r.newTag).toBe(contentTag("a\nx\nc"))
        expect(store.get("f.ts")!.content).toBe("a\nx\nc")
    })

    test("[BUG?] a gate that throws is turned into a rejected ApplyResult rather than an unhandled rejection", async () => {
        const content = "a\nb\nc"
        const { store, tag } = fresh("f.ts", content)
        const r = await applyPatch(
            `[f.ts#${tag}]\nreplace 2..2:\n+x`,
            { content, path: "f.ts", verifyBeforeWrite: async () => { throw new Error("boom") } },
            store,
        ).catch(e => ({ ok: false, error: String(e), thrown: true }))
        expect((r as any).thrown).toBeUndefined()
        expect(r.ok).toBe(false)
    })
})

// ─── 10. consumer-level: build-agent's 12,000-char cap ───────────────────────

describe("build-agent readExistingTargets cap (mirrors packages/agent/src/build-agent.ts:267-271)", () => {
    test("[BUG?] a file > 12,000 chars: the tag shown to the model matches the live file tag", async () => {
        const lines: string[] = []
        for (let i = 0; i < 400; i++) lines.push(`export const v${i} = ${i} // padding padding padding`)
        const content = lines.join("\n") + "\n"
        expect(content.length).toBeGreaterThan(12_000)
        const store = new SnapshotStore()
        const capped = content.length > 12_000
            ? content.slice(0, 12_000) + "\n… (truncated — file continues, re-read for more)"
            : content
        const { entry } = formatReadOutput("big.ts", capped, { store })
        // build-agent:475 then re-records live content and applies with the model's tag
        store.record("big.ts", content)
        const r = await applyPatch(`[big.ts#${entry.tag}]\nreplace 1..1:\n+export const v0 = 100`, { content, path: "big.ts" }, store)
        expect(r.ok).toBe(true)
    })
})

// ─── 11. fingerprint sanity ───────────────────────────────────────────────────

describe("fingerprints", () => {
    test("lineFingerprint is 24 bits at most (6 hex) and can be shorter for small hashes", () => {
        // .toString(16).slice(0,6) without padStart: hashes < 16^5 give < 6 chars — still deterministic
        const fp = lineFingerprint("hello")
        expect(fp.length).toBeLessThanOrEqual(6)
        expect(fp).toMatch(/^[0-9a-f]+$/)
    })
})
