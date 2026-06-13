import { contentTag, normalizeContent } from "./hash.ts"
import type { SnapshotEntry } from "./types.ts"
import { SnapshotStore } from "./snapshot.ts"

export interface ReadFormatOptions {
    offset?: number
    /** Include elision marker when truncated */
    truncated?: boolean
    store?: SnapshotStore
}

/**
 * Format file content for LLM read output with `[path#tag]` header.
 * Records snapshot for subsequent hashline edits.
 */
export function formatReadOutput(
    filePath: string,
    content: string,
    options: ReadFormatOptions = {},
): { text: string; entry: SnapshotEntry } {
    const store = options.store ?? new SnapshotStore()
    const norm = normalizeContent(content)
    const entry = store.record(filePath, norm)
    const lines = norm.split("\n")
    const offset = options.offset ?? 1

    const header = `[${filePath}#${entry.tag}]`
    const body = lines.map((line, i) => `${i + offset}:${line}`).join("\n")
    const elision = options.truncated ? "\n… (truncated — read again with offset for more)" : ""

    return {
        text: `${header}\n${body}${elision}\n\n# hashline: use edit.hashline with tag #${entry.tag}`,
        entry,
    }
}

/** Response after successful hashline apply — fresh tag + changed region preview. */
export function formatEditResponse(
    filePath: string,
    newContent: string,
    changedLines: number[],
    store: SnapshotStore,
): string {
    const entry = store.record(filePath, newContent)
    const lines = newContent.split("\n")
    const preview = changedLines
        .slice(0, 30)
        .map(n => `${n}:${lines[n - 1] ?? ""}`)
        .join("\n")

    return (
        `Applied hashline patch to ${filePath}\n` +
        `New snapshot: [${filePath}#${entry.tag}]\n` +
        `Changed lines (re-anchor next edit on these numbers or re-read):\n${preview}`
    )
}
