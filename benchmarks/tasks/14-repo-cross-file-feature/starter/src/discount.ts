export type Discount =
    | { type: "PERCENTAGE"; value: number }

export function applyDiscount(subtotal: number, discount: Discount | null): number {
    if (!discount) return subtotal
    if (discount.type === "PERCENTAGE") {
        return subtotal * (1 - discount.value / 100)
    }
    return subtotal
}
