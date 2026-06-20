// Tracks files actually written during a single orchestrated task. This is the
// source of truth for "were changes produced" — independent of git, so it works
// in non-git directories and for new untracked files.

const written = new Set<string>()

export function recordWrite(path: string): void {
    written.add(path)
}

export function reset(): void {
    written.clear()
}

export function take(): string[] {
    const all = [...written]
    written.clear()
    return all
}
