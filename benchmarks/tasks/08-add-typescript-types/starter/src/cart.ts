// Shopping cart logic — add TypeScript types

export function createCart() {
    return { items: [], total: 0 }
}

export function addItem(cart, item) {
    cart.items.push(item)
    cart.total += item.price * item.quantity
    return cart
}

export function removeItem(cart, itemId) {
    const idx = cart.items.findIndex(i => i.id === itemId)
    if (idx !== -1) {
        cart.total -= cart.items[idx].price * cart.items[idx].quantity
        cart.items.splice(idx, 1)
    }
    return cart
}

export function getTotal(cart) {
    return cart.total
}
