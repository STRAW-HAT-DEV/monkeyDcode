// Duplicated date formatting instead of importing the shared helper from
// ./formatDate.ts — and it's drifted: no zero-padding, unlike formatDate.
function formatDateForReport(date: Date): string {
    const y = date.getFullYear()
    const m = date.getMonth() + 1
    const d = date.getDate()
    return `${y}-${m}-${d}`
}

export function generateReportHeader(title: string, date: Date): string {
    return `${title} — ${formatDateForReport(date)}`
}
