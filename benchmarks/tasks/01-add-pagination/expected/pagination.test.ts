import { test, expect } from "bun:test"
import { getUsers } from "../src/users"

test("returns first page by default", () => {
    const result = getUsers()
    expect(result).toBeDefined()
})

test("page 1 returns first 10 users", () => {
    const result = getUsers(1, 10)
    expect(result.users.length).toBe(10)
    expect(result.users[0].id).toBe(1)
})

test("page 2 returns next 10 users", () => {
    const result = getUsers(2, 10)
    expect(result.users.length).toBe(10)
    expect(result.users[0].id).toBe(11)
})

test("returns total count", () => {
    const result = getUsers(1, 10)
    expect(result.total).toBe(100)
})

test("last page returns remaining users", () => {
    const result = getUsers(10, 10)
    expect(result.users.length).toBe(10)
    expect(result.users[9].id).toBe(100)
})

test("page size respected", () => {
    const result = getUsers(1, 5)
    expect(result.users.length).toBe(5)
})
