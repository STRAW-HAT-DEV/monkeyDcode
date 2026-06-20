/**
 * MDC Hashline — line-anchored patches with content-hash stale rejection.
 *
 * Improvements over omp hashline:
 * - Per-line content fingerprints stored in snapshots (detect drift inside a file)
 * - Optional verifyBeforeWrite gate (hooks into consistency pipeline)
 * - Anchor-echo absorption on insert (single-line duplicate prevention)
 * - All-or-nothing preflight before any disk write
 */

export type {
    HashlinePatch,
    HashlineSection,
    HashlineOp,
    ApplyResult,
    ApplyOptions,
    SnapshotEntry,
} from "./types.ts"

export {
    normalizeContent,
    contentTag,
    lineFingerprint,
    fingerprintsForContent,
} from "./hash.ts"

export { SnapshotStore, globalSnapshotStore } from "./snapshot.ts"
export { formatReadOutput, formatEditResponse } from "./format.ts"
export { parsePatch, looksLikeHashlinePatch } from "./parse.ts"
export { applyPatch, applyPatchToFile } from "./apply.ts"
export { HASHLINE_EDIT_PROMPT } from "./prompt.ts"
