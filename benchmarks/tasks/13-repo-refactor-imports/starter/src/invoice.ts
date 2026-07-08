// Also duplicated, independently, elsewhere — and drifted into a completely
// different (wrong) format: D/M/Y instead of formatDate's Y-M-D.
function dateStr(date: Date): string {
    const y = date.getFullYear()
    const m = date.getMonth() + 1
    const d = date.getDate()
    return `${d}/${m}/${y}`
}

export function formatInvoiceLine(item: string, amount: number, date: Date): string {
    return `${dateStr(date)} | ${item} | $${amount.toFixed(2)}`
}
