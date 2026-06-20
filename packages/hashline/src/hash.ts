/** Normalize line endings and strip BOM for stable hashing. */
export function normalizeContent(text: string): string {
    return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
}

/** 4-hex file snapshot tag (omp-compatible). */
export function contentTag(text: string): string {
    const norm = normalizeContent(text)
    const h = Bun.hash(norm)
    return h.toString(16).slice(0, 4).padStart(4, "0")
}

/** 6-hex per-line fingerprint — MDC addition for intra-file drift detection. */
export function lineFingerprint(line: string): string {
    return Bun.hash(line).toString(16).slice(0, 6)
}

export function fingerprintsForContent(text: string): string[] {
    const norm = normalizeContent(text)
    if (norm === "") return []
    const lines = norm.split("\n")
    return lines.map(lineFingerprint)
}

export function verifyLineFingerprints(
    content: string,
    start: number,
    end: number,
    expected: string[],
): { ok: boolean; line?: number; message?: string } {
    const lines = normalizeContent(content).split("\n")
    for (let n = start; n <= end; n++) {
        const idx = n - 1
        const line = lines[idx]
        if (line === undefined) {
            return { ok: false, line: n, message: `Line ${n} does not exist (file has ${lines.length} lines)` }
        }
        const fp = lineFingerprint(line)
        const exp = expected[idx]
        if (exp && fp !== exp) {
            return {
                ok: false,
                line: n,
                message: `Line ${n} content changed (fingerprint ${fp} ≠ expected ${exp}). Re-read the file.`,
            }
        }
    }
    return { ok: true }
}
