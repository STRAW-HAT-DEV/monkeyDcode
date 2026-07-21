import { test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtemp, writeFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { extractRefs, validateAssets, check, formatReport } from "../src/verification/assets.ts"

// ─── Pure extraction (no network) ────────────────────────────────────────────

test("extractRefs finds img src, link href, css url(), and markdown images", () => {
    const html = `
<img src="logo.png">
<link href="styles.css" rel="stylesheet">
<div style="background: url('bg.jpg')"></div>
![alt](diagram.svg)
<a href="#section">skip anchors</a>
<img src="data:image/png;base64,AAAA">
`
    const refs = extractRefs(html, "index.html")
    const raws = refs.map(r => r.raw)
    expect(raws).toContain("logo.png")
    expect(raws).toContain("styles.css")
    expect(raws).toContain("bg.jpg")
    expect(raws).toContain("diagram.svg")
    // anchors and data: URIs are ignored, not treated as broken assets
    expect(raws).not.toContain("#section")
    expect(raws.some(r => r.startsWith("data:"))).toBe(false)
})

test("extractRefs classifies external vs local and keeps line numbers", () => {
    const html = `line1\n<img src="https://example.com/a.png">\n<img src="./b.png">`
    const refs = extractRefs(html, "p.html")
    const ext = refs.find(r => r.raw.includes("example.com"))!
    const loc = refs.find(r => r.raw === "./b.png")!
    expect(ext.kind).toBe("external")
    expect(ext.line).toBe(2)
    expect(loc.kind).toBe("local")
    expect(loc.line).toBe(3)
})

// ─── Local file validation (no network) ──────────────────────────────────────

let root: string
beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mdc-assets-"))
})
afterAll(async () => {
    await rm(root, { recursive: true, force: true })
})

test("a local reference to a missing file is reported as a DEAD error", async () => {
    await writeFile(join(root, "page.html"), `<img src="missing-logo.svg">`)
    const results = await validateAssets(["page.html"], root)
    const r = results.find(x => x.ref.raw === "missing-logo.svg")!
    expect(r.ok).toBe(false)
    expect(r.severity).toBe("error")
    expect(r.reason).toBe("missing file")
})

test("a local reference that exists passes", async () => {
    await writeFile(join(root, "real.svg"), "<svg/>")
    await writeFile(join(root, "ok.html"), `<img src="real.svg">`)
    const results = await validateAssets(["ok.html"], root)
    const r = results.find(x => x.ref.raw === "real.svg")!
    expect(r.ok).toBe(true)
})

test("query strings and hashes are stripped when resolving local files", async () => {
    await writeFile(join(root, "sprite.svg"), "<svg/>")
    await writeFile(join(root, "q.html"), `<img src="sprite.svg?v=2"><use href="sprite.svg#icon"/>`)
    const results = await validateAssets(["q.html"], root)
    expect(results.every(r => r.ok)).toBe(true)
})

test("check() stage fails on a missing local asset and passes when it's added", async () => {
    await writeFile(join(root, "stage.html"), `<img src="hero.jpg">`)
    let result = await check(["stage.html"], root)
    expect(result.passed).toBe(false)
    expect(result.errors[0]?.rule).toBe("assets")

    await writeFile(join(root, "hero.jpg"), "x")
    result = await check(["stage.html"], root)
    expect(result.passed).toBe(true)
})

test("the NIKE scenario: a dead remote logo URL is caught (real network)", async () => {
    // The exact broken URL from the user's landing page — a 400 from Wikimedia.
    const deadUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Nike_logo.svg/2000px-Nike_logo.svg.png"
    await writeFile(join(root, "nike.html"), `<h1><img src="${deadUrl}" width="50"></h1>`)
    const results = await validateAssets(["nike.html"], root)
    const r = results.find(x => x.ref.raw === deadUrl)
    expect(r).toBeDefined()
    // Either a definite 4xx/5xx (DEAD) or, if offline, a network warning — but
    // never silently "ok". A reachable network must report it broken.
    expect(r!.ok).toBe(false)
}, 15_000)

test("formatReport summarizes broken vs ok", () => {
    const report = formatReport([
        { ref: { file: "i.html", line: 1, raw: "x.png", kind: "local", origin: "src attribute" }, ok: false, reason: "missing file", severity: "error" },
    ])
    expect(report).toContain("1 broken reference")
    expect(report).toContain("DEAD")
    expect(report).toContain("x.png")
})
