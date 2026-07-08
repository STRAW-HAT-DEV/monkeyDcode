import { test, expect } from "bun:test"
import { applyDiscount } from "./src/discount"
import { Cart } from "./src/cart"

test("PERCENTAGE discount still works (regression)", () => {
    expect(applyDiscount(100, { type: "PERCENTAGE", value: 10 })).toBe(90)
})

test("FIXED_AMOUNT discount subtracts a flat value", () => {
    expect(applyDiscount(100, { type: "FIXED_AMOUNT", value: 15 } as never)).toBe(85)
})

test("FIXED_AMOUNT discount never goes below 0", () => {
    expect(applyDiscount(10, { type: "FIXED_AMOUNT", value: 50 } as never)).toBe(0)
})

test("no discount returns the subtotal unchanged", () => {
    expect(applyDiscount(50, null)).toBe(50)
})

test("Cart applies a FIXED_AMOUNT discount to its total with no changes needed in cart.ts", () => {
    const cart = new Cart()
    cart.addItem(20, 2) // subtotal 40
    cart.setDiscount({ type: "FIXED_AMOUNT", value: 5 } as never)
    expect(cart.total()).toBe(35)
})
