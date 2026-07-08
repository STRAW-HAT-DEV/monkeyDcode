import { test, expect } from "bun:test"
import { generateReportHeader } from "./src/report"
import { formatInvoiceLine } from "./src/invoice"
import { formatDate } from "./src/formatDate"

test("generateReportHeader formats its date the same way formatDate does", () => {
    const date = new Date(2026, 0, 5) // Jan 5, 2026
    const header = generateReportHeader("Sales Report", date)
    expect(header).toBe(`Sales Report — ${formatDate(date)}`)
})

test("formatInvoiceLine formats its date the same way formatDate does", () => {
    const date = new Date(2026, 11, 25) // Dec 25, 2026
    const line = formatInvoiceLine("Widget", 19.99, date)
    expect(line).toBe(`${formatDate(date)} | Widget | $19.99`)
})

test("formatDate itself still works as the single source of truth", () => {
    expect(formatDate(new Date(2026, 5, 1))).toBe("2026-06-01")
})
