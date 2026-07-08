import { test, expect } from "bun:test"
import { createCart, addItem, removeItem, getTotal } from "./src/cart"

test("createCart returns typed structure", () => {
    const cart = createCart()
    expect(cart.items).toBeArray()
    expect(cart.total).toBe(0)
})

test("addItem increases total", () => {
    const cart = createCart()
    addItem(cart, { id: 1, name: "Widget", price: 10, quantity: 2 })
    expect(getTotal(cart)).toBe(20)
})

test("removeItem decreases total", () => {
    const cart = createCart()
    addItem(cart, { id: 1, name: "Widget", price: 10, quantity: 2 })
    removeItem(cart, 1)
    expect(getTotal(cart)).toBe(0)
    expect(cart.items.length).toBe(0)
})

test("removeItem on nonexistent id does nothing", () => {
    const cart = createCart()
    addItem(cart, { id: 1, name: "Widget", price: 5, quantity: 1 })
    removeItem(cart, 999)
    expect(cart.items.length).toBe(1)
})
