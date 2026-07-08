import { applyDiscount, type Discount } from "./discount"

export class Cart {
    private items: { price: number; qty: number }[] = []
    private discount: Discount | null = null

    addItem(price: number, qty: number): void {
        this.items.push({ price, qty })
    }

    setDiscount(discount: Discount | null): void {
        this.discount = discount
    }

    total(): number {
        const subtotal = this.items.reduce((sum, i) => sum + i.price * i.qty, 0)
        return applyDiscount(subtotal, this.discount)
    }
}
