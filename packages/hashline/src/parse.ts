import type { HashlineOp, HashlinePatch, HashlineSection } from "./types.ts"

const SECTION_RE = /^\[([^\]#]+)#([0-9a-fA-F]{4})\]\s*$/
const REPLACE_RE = /^replace\s+(\d+)\.\.(\d+)\s*:\s*$/
const DELETE_RANGE_RE = /^delete\s+(\d+)\.\.(\d+)\s*$/
const DELETE_ONE_RE = /^delete\s+(\d+)\s*$/
const INSERT_BEFORE_RE = /^insert\s+before\s+(\d+)\s*:\s*$/
const INSERT_AFTER_RE = /^insert\s+after\s+(\d+)\s*:\s*$/
const INSERT_HEAD_RE = /^insert\s+head\s*:\s*$/
const INSERT_TAIL_RE = /^insert\s+tail\s*:\s*$/
const BODY_RE = /^\+(.*)$/

function unescapeBody(text: string): string {
    if (text.startsWith("+") || text.startsWith("-")) return text.slice(1)
    return text
}

function parseBodyLines(lines: string[], startIdx: number): { body: string[]; nextIdx: number } {
    const body: string[] = []
    let i = startIdx
    while (i < lines.length) {
        const line = lines[i]!
        if (line.trim() === "") {
            i++
            continue
        }
        if (SECTION_RE.test(line) || isOpHeader(line)) break
        const m = BODY_RE.exec(line)
        if (!m) break
        body.push(m[1] === undefined || m[1] === "" ? "" : unescapeBody(m[1]))
        i++
    }
    return { body, nextIdx: i }
}

function isOpHeader(line: string): boolean {
    const t = line.trim()
    return (
        REPLACE_RE.test(t) ||
        DELETE_RANGE_RE.test(t) ||
        DELETE_ONE_RE.test(t) ||
        INSERT_BEFORE_RE.test(t) ||
        INSERT_AFTER_RE.test(t) ||
        INSERT_HEAD_RE.test(t) ||
        INSERT_TAIL_RE.test(t) ||
        /^replace\s+block\s+\d+\s*:/.test(t) ||
        /^delete\s+block\s+\d+/.test(t) ||
        /^insert\s+after\s+block\s+\d+\s*:/.test(t)
    )
}

/** Detect hashline patch (section header or common ops). */
export function looksLikeHashlinePatch(text: string): boolean {
    return SECTION_RE.test(text.trim()) || /^\[.+\#[0-9a-fA-F]{4}\]/m.test(text)
}

export function parsePatch(text: string): HashlinePatch {
    const lines = text.replace(/\r\n/g, "\n").split("\n")
    const sections: HashlineSection[] = []
    let i = 0

    while (i < lines.length) {
        const line = lines[i]!.trim()
        if (line === "" || line.startsWith("#")) {
            i++
            continue
        }

        const sec = SECTION_RE.exec(line)
        if (!sec) {
            i++
            continue
        }

        const path = sec[1]!.trim()
        const tag = sec[2]!
        const ops: HashlineOp[] = []
        i++

        while (i < lines.length) {
            const raw = lines[i]!
            const opLine = raw.trim()
            if (opLine === "" || opLine.startsWith("#")) {
                i++
                continue
            }
            if (SECTION_RE.test(opLine)) break

            let m = REPLACE_RE.exec(opLine)
            if (m) {
                i++
                const { body, nextIdx } = parseBodyLines(lines, i)
                i = nextIdx
                ops.push({
                    kind: "replace",
                    start: parseInt(m[1]!, 10),
                    end: parseInt(m[2]!, 10),
                    lines: body,
                })
                continue
            }

            m = DELETE_RANGE_RE.exec(opLine)
            if (m) {
                ops.push({
                    kind: "delete",
                    start: parseInt(m[1]!, 10),
                    end: parseInt(m[2]!, 10),
                })
                i++
                continue
            }

            m = DELETE_ONE_RE.exec(opLine)
            if (m) {
                ops.push({
                    kind: "delete",
                    start: parseInt(m[1]!, 10),
                    end: parseInt(m[1]!, 10),
                })
                i++
                continue
            }

            m = INSERT_BEFORE_RE.exec(opLine)
            if (m) {
                i++
                const { body, nextIdx } = parseBodyLines(lines, i)
                i = nextIdx
                ops.push({ kind: "insert", position: "before", line: parseInt(m[1]!, 10), lines: body })
                continue
            }

            m = INSERT_AFTER_RE.exec(opLine)
            if (m) {
                i++
                const { body, nextIdx } = parseBodyLines(lines, i)
                i = nextIdx
                ops.push({ kind: "insert", position: "after", line: parseInt(m[1]!, 10), lines: body })
                continue
            }

            if (INSERT_HEAD_RE.test(opLine)) {
                i++
                const { body, nextIdx } = parseBodyLines(lines, i)
                i = nextIdx
                ops.push({ kind: "insert", position: "head", line: 0, lines: body })
                continue
            }

            if (INSERT_TAIL_RE.test(opLine)) {
                i++
                const { body, nextIdx } = parseBodyLines(lines, i)
                i = nextIdx
                ops.push({ kind: "insert", position: "tail", line: 0, lines: body })
                continue
            }

            // `replace block` / tree-sitter — fall back to single-line replace for now
            const blockReplace = /^replace\s+block\s+(\d+)\s*:\s*$/.exec(opLine)
            if (blockReplace) {
                i++
                const { body, nextIdx } = parseBodyLines(lines, i)
                i = nextIdx
                ops.push({
                    kind: "replace",
                    start: parseInt(blockReplace[1]!, 10),
                    end: parseInt(blockReplace[1]!, 10),
                    lines: body,
                })
                continue
            }

            i++
        }

        if (ops.length > 0) sections.push({ path, tag, ops })
    }

    return { sections }
}
