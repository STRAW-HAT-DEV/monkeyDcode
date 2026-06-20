export type HashlineOp =
    | { kind: "replace"; start: number; end: number; lines: string[] }
    | { kind: "delete"; start: number; end: number }
    | { kind: "insert"; position: "before" | "after" | "head" | "tail"; line: number; lines: string[] }

export interface HashlineSection {
    path: string
    tag: string
    ops: HashlineOp[]
}

export interface HashlinePatch {
    sections: HashlineSection[]
}

export interface SnapshotEntry {
    tag: string
    content: string
    lineFingerprints: string[]
    recordedAt: number
}

export interface ApplyResult {
    ok: boolean
    path: string
    content?: string
    previousTag: string
    newTag?: string
    linesChanged: number
    error?: string
    stale?: boolean
    hint?: string
    preview?: string
}

export interface ApplyOptions {
    /** Current file content (required). */
    content: string
    /** Path for snapshot lookup/recording. */
    path: string
    /** Reject if live tag !== section tag (default true). */
    strictTag?: boolean
    /** Verify line fingerprints in touched ranges (default true). */
    strictLines?: boolean
    /** Called before commit; return false to abort without writing. */
    verifyBeforeWrite?: (nextContent: string) => Promise<{ ok: boolean; message?: string }>
}
