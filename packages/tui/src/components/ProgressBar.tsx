export function ProgressBar({ current, total }: { current: number; total: number }) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0
    const filled = "█".repeat(Math.round(pct / 5))
    const empty = "░".repeat(Math.max(0, 20 - filled.length))
    return <text>[{filled}{empty}] {pct}% ({current}/{total})</text>
}
