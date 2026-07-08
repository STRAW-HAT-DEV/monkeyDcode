import { test, expect } from "bun:test"
import { debounce } from "./src/debounce"

test("calls function after delay", async () => {
    let count = 0
    const debounced = debounce(() => { count++ }, 50)
    debounced()
    expect(count).toBe(0)
    await new Promise(r => setTimeout(r, 100))
    expect(count).toBe(1)
})

test("resets timer on repeated calls", async () => {
    let count = 0
    const debounced = debounce(() => { count++ }, 50)
    debounced()
    debounced()
    debounced()
    await new Promise(r => setTimeout(r, 100))
    expect(count).toBe(1)
})

test("passes arguments through", async () => {
    let received: number[] = []
    const debounced = debounce((x: number) => { received.push(x) }, 30)
    debounced(1)
    debounced(2)
    debounced(3)
    await new Promise(r => setTimeout(r, 80))
    expect(received).toEqual([3])
})

test("can be called multiple times with delay between", async () => {
    let count = 0
    const debounced = debounce(() => { count++ }, 30)
    debounced()
    await new Promise(r => setTimeout(r, 80))
    debounced()
    await new Promise(r => setTimeout(r, 80))
    expect(count).toBe(2)
})
