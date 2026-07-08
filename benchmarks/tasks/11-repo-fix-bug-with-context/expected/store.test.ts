import { test, expect } from "bun:test"
import { TodoStore } from "./src/store"

test("add assigns an id and returns the created todo", () => {
    const store = new TodoStore()
    const a = store.add("Buy milk")
    expect(a.title).toBe("Buy milk")
    expect(a.done).toBe(false)
})

test("remove deletes the todo matching the given id, not by array position", () => {
    const store = new TodoStore()
    const a = store.add("A")
    const b = store.add("B")
    const c = store.add("C")

    const removed = store.remove(a.id)
    expect(removed).toBe(true)

    const remaining = store.list()
    expect(remaining.length).toBe(2)
    expect(remaining.some(t => t.id === b.id)).toBe(true)
    expect(remaining.some(t => t.id === c.id)).toBe(true)
    expect(remaining.some(t => t.id === a.id)).toBe(false)
})

test("remove leaves other todos alone when removing from the middle", () => {
    const store = new TodoStore()
    const a = store.add("A")
    const b = store.add("B")
    const c = store.add("C")

    store.remove(b.id)

    const remaining = store.list()
    expect(remaining.length).toBe(2)
    expect(remaining.some(t => t.id === a.id)).toBe(true)
    expect(remaining.some(t => t.id === c.id)).toBe(true)
})

test("remove returns false for an id that doesn't exist", () => {
    const store = new TodoStore()
    store.add("A")
    expect(store.remove(9999)).toBe(false)
})

test("list returns todos in insertion order", () => {
    const store = new TodoStore()
    store.add("first")
    store.add("second")
    const items = store.list()
    expect(items[0]!.title).toBe("first")
    expect(items[1]!.title).toBe("second")
})
