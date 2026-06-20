import {
    contentTag,
    fingerprintsForContent,
    normalizeContent,
} from "./hash.ts"
import type { SnapshotEntry } from "./types.ts"

export class SnapshotStore {
    private entries = new Map<string, SnapshotEntry>()

    record(path: string, content: string): SnapshotEntry {
        const norm = normalizeContent(content)
        const entry: SnapshotEntry = {
            tag: contentTag(norm),
            content: norm,
            lineFingerprints: fingerprintsForContent(norm),
            recordedAt: Date.now(),
        }
        this.entries.set(this.key(path), entry)
        return entry
    }

    get(path: string): SnapshotEntry | undefined {
        return this.entries.get(this.key(path))
    }

    verifyTag(path: string, tag: string, liveContent: string): { ok: boolean; message?: string } {
        const live = normalizeContent(liveContent)
        const liveTag = contentTag(live)
        if (tag.toLowerCase() !== liveTag.toLowerCase()) {
            const stored = this.get(path)
            return {
                ok: false,
                message:
                    `Stale snapshot tag #${tag} — file is now #${liveTag}. ` +
                    (stored ? "File changed since last read." : "Record a snapshot with read first."),
            }
        }
        return { ok: true }
    }

    private key(path: string): string {
        return path.replace(/\\/g, "/")
    }
}

/** Process-wide store keyed by absolute path (engine + agent share). */
export const globalSnapshotStore = new SnapshotStore()
